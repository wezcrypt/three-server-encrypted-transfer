'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { loadNodeConfig } = require('../shared/config');
const { TransferDatabase } = require('../shared/database');
const { hashFile } = require('../shared/crypto');
const { loadMtlsMaterial, createServerTlsOptions, verifyRequestPeer } = require('../shared/mtls');
const { chunkDescriptorSchema, remoteTransferManifestSchema } = require('../shared/validation');
const { ensurePrivateDirectory, publicError, readJson, safeStoragePath, sendJson, streamRequestToFile } = require('../shared/http-utils');
const { removeStalePartFiles } = require('../shared/recovery');
const { createLogger, getHealthSnapshot } = require('../shared/observability');

function localManifest(remote) {
  return {
    ...remote,
    originalFilename: `opaque-${remote.fileId}`,
    contentType: 'application/octet-stream',
    plaintextSize: 0
  };
}

function sameRemoteManifest(current, incoming) {
  return current && current.transferId === incoming.transferId && current.fileId === incoming.fileId &&
    current.ciphertextSize === incoming.ciphertextSize && current.totalChunks === incoming.totalChunks &&
    current.chunkSize === incoming.chunkSize && current.ciphertextSha256 === incoming.ciphertextSha256 &&
    current.encryption.algorithm === incoming.encryption.algorithm && current.encryption.keyVersion === incoming.encryption.keyVersion &&
    current.encryption.aadVersion === incoming.encryption.aadVersion && current.encryption.chunkIvBytes === incoming.encryption.chunkIvBytes &&
    current.encryption.authTagBytes === incoming.encryption.authTagBytes;
}

async function moveNoReplace(source, destination) {
  try {
    await fsp.link(source, destination);
    await fsp.rm(source, { force: true });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

class StorageService {
  constructor(config) {
    this.config = config;
    this.database = new TransferDatabase(config.databasePath, path.resolve(__dirname, '../migrations'));
    this.tlsMaterial = loadMtlsMaterial({ ...config.tls, runtime: config.runtime });
    this.logger = createLogger('server3');
  }

  authorize(request, response) {
    const peer = verifyRequestPeer(request, 'server2');
    if (!peer.ok) { publicError(response, 403, peer.code); return false; }
    return true;
  }

  chunkPath(fileId, chunkIndex) {
    return safeStoragePath(this.config.storagePath, 'files', fileId, 'chunks', `${String(chunkIndex).padStart(8, '0')}.chunk`);
  }

  storageKey(fileId) {
    return `files/${fileId}`;
  }

  async receiveManifest(request, response) {
    if (!this.authorize(request, response)) return;
    try {
      const remote = remoteTransferManifestSchema.parse(await readJson(request));
      const created = this.database.createTransfer({
        manifest: localManifest(remote),
        state: 'STORAGE_RECEIVING',
        sourceNode: 'server2',
        destinationNode: 'server3',
        storageKey: this.storageKey(remote.fileId),
        includeWrappedDek: false
      });
      if (!created) {
        const current = this.database.getTransferManifest(remote.transferId, false);
        if (!sameRemoteManifest(current, remote)) return publicError(response, 409, 'TRANSFER_MANIFEST_CONFLICT');
        const existing = this.database.getTransfer(remote.transferId);
        if (existing.state === 'FAILED' || existing.state === 'RECOVERY_PENDING') {
          this.database.prepareForRecovery(remote.transferId, 'STORAGE_RECEIVING', 'MANIFEST_RETRY');
        }
      }
      return sendJson(response, created ? 201 : 200, { transferId: remote.transferId, nextChunk: this.database.nextExpectedChunk(remote.transferId) });
    } catch (error) {
      return publicError(response, error.message.startsWith('REQUEST_BODY') ? 400 : 422, 'INVALID_MANIFEST');
    }
  }

  async receiveChunk(request, response, transferId, chunkIndex) {
    if (!this.authorize(request, response)) return;
    const transfer = this.database.getTransfer(transferId);
    if (!transfer || transfer.state !== 'STORAGE_RECEIVING') return publicError(response, 409, 'TRANSFER_NOT_RECEIVING');
    let descriptor;
    try {
      descriptor = chunkDescriptorSchema.parse({
        transferId,
        chunkIndex,
        chunkSha256: request.headers['x-chunk-sha256'],
        chunkSize: Number(request.headers['x-chunk-size'])
      });
    } catch (_) { return publicError(response, 422, 'INVALID_CHUNK_METADATA'); }
    if (descriptor.chunkSize > transfer.chunk_size) return publicError(response, 413, 'CHUNK_TOO_LARGE');
    const finalPath = this.chunkPath(transfer.file_id, chunkIndex);
    const tempPath = `${finalPath}.${crypto.randomUUID()}.part`;
    try {
      const stored = await streamRequestToFile({
        request,
        outputPath: tempPath,
        maxBytes: transfer.chunk_size,
        expectedBytes: descriptor.chunkSize
      });
      if (stored.sha256 !== descriptor.chunkSha256) {
        await fsp.rm(tempPath, { force: true });
        return publicError(response, 422, 'CHUNK_HASH_MISMATCH');
      }
      await ensurePrivateDirectory(path.dirname(finalPath));
      const moved = await moveNoReplace(tempPath, finalPath);
      if (!moved) {
        const existingHash = await hashFile(finalPath);
        const existingSize = (await fsp.stat(finalPath)).size;
        if (existingHash !== descriptor.chunkSha256 || existingSize !== descriptor.chunkSize) return publicError(response, 409, 'CONFLICTING_CHUNK');
      }
      const result = this.database.recordVerifiedChunk({
        transferId,
        chunkIndex,
        chunkSha256: descriptor.chunkSha256,
        byteSize: descriptor.chunkSize,
        storedPath: finalPath
      });
      return sendJson(response, result.duplicate ? 200 : 201, { transferId, chunkIndex, nextChunk: result.nextExpectedChunk });
    } catch (error) {
      if (error.message === 'REQUEST_BODY_TOO_LARGE' || error.message === 'REQUEST_BODY_SIZE_MISMATCH') return publicError(response, 413, error.message);
      return publicError(response, 409, 'CHUNK_REJECTED');
    }
  }

  async calculateCiphertextHash(transferId) {
    const chunks = this.database.getVerifiedChunks(transferId);
    const digest = crypto.createHash('sha256');
    for (const chunk of chunks) {
      for await (const part of fs.createReadStream(chunk.stored_path, { highWaterMark: 1024 * 1024 })) digest.update(part);
    }
    return digest.digest('hex');
  }

  async complete(request, response, transferId) {
    if (!this.authorize(request, response)) return;
    const transfer = this.database.getTransfer(transferId);
    if (!transfer) return publicError(response, 404, 'NOT_FOUND');
    if (transfer.state === 'STORED') return sendJson(response, 200, { transferId, status: 'STORED', storageKey: transfer.storage_key || this.storageKey(transfer.file_id) });
    if (transfer.state !== 'STORAGE_RECEIVING') return publicError(response, 409, 'INVALID_TRANSFER_STATE');
    try {
      await readJson(request).catch((error) => { if (error.message !== 'REQUEST_BODY_EMPTY') throw error; return {}; });
      if (!this.database.verifyComplete(transferId)) return publicError(response, 409, 'MISSING_CHUNKS');
      const fullHash = await this.calculateCiphertextHash(transferId);
      if (fullHash !== transfer.ciphertext_sha256) return publicError(response, 422, 'CIPHERTEXT_HASH_MISMATCH');
      this.database.setStorageKey(transfer.file_id, this.storageKey(transfer.file_id));
      this.database.transition(transferId, 'STORED', { fullHashVerified: true });
      this.logger.info({ event: 'storage_stored', transferId, fileId: transfer.file_id }, 'storage confirmed ciphertext');
      return sendJson(response, 200, { transferId, status: 'STORED', storageKey: this.storageKey(transfer.file_id) });
    } catch (_) {
      this.database.forceFailure(transferId, 'FINAL_STORAGE_VERIFICATION_FAILED');
      this.logger.warn({ event: 'storage_verification_failed', transferId, code: 'FINAL_STORAGE_VERIFICATION_FAILED' }, 'storage verification failed');
      return publicError(response, 502, 'FINAL_STORAGE_VERIFICATION_FAILED');
    }
  }

  status(request, response, transferId) {
    if (!this.authorize(request, response)) return;
    const transfer = this.database.getTransfer(transferId);
    if (!transfer) return publicError(response, 404, 'NOT_FOUND');
    return sendJson(response, 200, {
      transferId,
      state: transfer.state,
      storageKey: transfer.storage_key || null,
      nextChunk: this.database.nextExpectedChunk(transferId)
    });
  }

  async runMaintenance() {
    const cutoff = Date.now() - this.config.limits.staleTransferHours * 60 * 60 * 1000;
    this.database.recoverStaleTransfers(new Date(cutoff).toISOString());
    await removeStalePartFiles(this.config.storagePath, cutoff);
  }

  async health(request, response) {
    if (!this.authorize(request, response)) return;
    return sendJson(response, 200, await getHealthSnapshot(this.database, this.config.storagePath));
  }

  async handler(request, response) {
    try {
      const pathname = new URL(request.url, 'https://server3').pathname;
      if (request.method === 'GET' && pathname === '/health') return await this.health(request, response);
      if (request.method === 'POST' && pathname === '/internal/transfers') return await this.receiveManifest(request, response);
      const chunkMatch = /^\/internal\/transfers\/([0-9a-f-]{36})\/chunks\/(\d+)$/.exec(pathname);
      if (request.method === 'PUT' && chunkMatch) return await this.receiveChunk(request, response, chunkMatch[1], Number(chunkMatch[2]));
      const completeMatch = /^\/internal\/transfers\/([0-9a-f-]{36})\/complete$/.exec(pathname);
      if (request.method === 'POST' && completeMatch) return await this.complete(request, response, completeMatch[1]);
      const statusMatch = /^\/internal\/transfers\/([0-9a-f-]{36})\/status$/.exec(pathname);
      if (request.method === 'GET' && statusMatch) return this.status(request, response, statusMatch[1]);
      return publicError(response, 404, 'NOT_FOUND');
    } catch (_) { this.logger.error({ event: 'request_error' }, 'request processing failed'); return publicError(response, 500, 'INTERNAL_ERROR'); }
  }

  close() { this.database.close(); }
}

function startServer(config = loadNodeConfig('server3')) {
  const service = new StorageService(config);
  const server = https.createServer(createServerTlsOptions(service.tlsMaterial), (request, response) => service.handler(request, response));
  server.requestTimeout = config.limits.requestTimeoutMs;
  server.headersTimeout = Math.min(config.limits.requestTimeoutMs, 60_000);
  server.listen(config.port, config.bindHost);
  const recoveryTimer = setInterval(() => { service.runMaintenance().catch(() => undefined); }, 60_000);
  recoveryTimer.unref();
  service.runMaintenance().catch(() => undefined);
  return { server, service, recoveryTimer };
}

if (require.main === module) {
  const { server, service } = startServer();
  const shutdown = () => server.close(() => { service.close(); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { StorageService, startServer };
