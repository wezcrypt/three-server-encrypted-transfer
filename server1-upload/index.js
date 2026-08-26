'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { loadNodeConfig } = require('../shared/config');
const { TransferDatabase } = require('../shared/database');
const { createKeyProvider } = require('../shared/key-provider');
const { encryptStreamToFile, generateDek, readFixedChunks, sha256 } = require('../shared/crypto');
const { loadMtlsMaterial, createPublicTlsOptions, mtlsRequest } = require('../shared/mtls');
const { remoteTransferManifestSchema, sanitizeFilename } = require('../shared/validation');
const { createRateLimiter, publicError, safeStoragePath, sendJson, verifyBearer } = require('../shared/http-utils');
const { failStaleEncryptionDrafts, removeStalePartFiles } = require('../shared/recovery');
const { createLogger, getHealthSnapshot } = require('../shared/observability');

function parseResponse(response) {
  let body = {};
  if (response.body.length > 0) {
    try { body = JSON.parse(response.body.toString('utf8')); } catch (_) { throw new Error('Relay returned invalid JSON.'); }
  }
  return { statusCode: response.statusCode, body };
}

function asRemoteManifest(manifest) {
  return {
    transferId: manifest.transferId,
    fileId: manifest.fileId,
    ciphertextSize: manifest.ciphertextSize,
    totalChunks: manifest.totalChunks,
    chunkSize: manifest.chunkSize,
    ciphertextSha256: manifest.ciphertextSha256,
    encryption: {
      algorithm: manifest.encryption.algorithm,
      keyVersion: manifest.encryption.keyVersion,
      aadVersion: manifest.encryption.aadVersion,
      chunkIvBytes: manifest.encryption.chunkIvBytes,
      authTagBytes: manifest.encryption.authTagBytes
    }
  };
}

class UploadService {
  constructor(config) {
    this.config = config;
    this.database = new TransferDatabase(config.databasePath, path.resolve(__dirname, '../migrations'));
    this.tlsMaterial = loadMtlsMaterial({ ...config.tls, runtime: config.runtime });
    this.keyProvider = createKeyProvider({ runtime: config.runtime });
    this.rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });
    this.logger = createLogger('server1');
  }

  assertPublicAuthentication(request) {
    if (this.config.uploadToken && !verifyBearer(request, this.config.uploadToken)) return false;
    return this.config.runtime !== 'production' || Boolean(this.config.uploadToken);
  }

  async callRelay({ method, endpoint, headers = {}, body }) {
    const response = await mtlsRequest({
      target: this.config.relayUrl,
      method,
      path: endpoint,
      headers,
      body,
      material: this.tlsMaterial,
      expectedIdentity: 'server2',
      timeoutMs: this.config.limits.requestTimeoutMs
    });
    return parseResponse(response);
  }

  async relayCiphertext(transferId, ciphertextPath) {
    const manifest = this.database.getTransferManifest(transferId, true);
    if (!manifest) throw new Error('Transfer was not found.');
    const remoteManifest = remoteTransferManifestSchema.parse(asRemoteManifest(manifest));
    const manifestBody = Buffer.from(JSON.stringify(remoteManifest));
    const created = await this.callRelay({
      method: 'POST',
      endpoint: '/internal/transfers',
      headers: { 'content-type': 'application/json', 'content-length': String(manifestBody.length) },
      body: manifestBody
    });
    if (created.statusCode !== 201 && created.statusCode !== 200) throw new Error(`Relay rejected transfer manifest (${created.statusCode}).`);
    const transferBeforeRelay = this.database.getTransfer(transferId);
    if (transferBeforeRelay.state === 'ENCRYPTED') this.database.transition(transferId, 'RELAY_RECEIVING', { relayAccepted: true });
    const nextConfirmedChunk = Number.isInteger(created.body.nextChunk) ? created.body.nextChunk : 0;

    let chunkIndex = 0;
    for await (const chunk of readFixedChunks(ciphertextPath, manifest.chunkSize)) {
      if (chunkIndex < nextConfirmedChunk) { chunkIndex += 1; continue; }
      const digest = sha256(chunk);
      const result = await this.callRelay({
        method: 'PUT',
        endpoint: `/internal/transfers/${encodeURIComponent(transferId)}/chunks/${chunkIndex}`,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(chunk.length),
          'x-chunk-sha256': digest,
          'x-chunk-size': String(chunk.length)
        },
        body: chunk
      });
      if (result.statusCode !== 201 && result.statusCode !== 200) throw new Error(`Relay rejected chunk ${chunkIndex} (${result.statusCode}).`);
      chunkIndex += 1;
    }
    if (chunkIndex !== manifest.totalChunks) throw new Error('Local ciphertext chunk count does not match the manifest.');

    const completeBody = Buffer.from('{}');
    const complete = await this.callRelay({
      method: 'POST',
      endpoint: `/internal/transfers/${encodeURIComponent(transferId)}/complete`,
      headers: { 'content-type': 'application/json', 'content-length': String(completeBody.length) },
      body: completeBody
    });
    if (complete.statusCode !== 200 || complete.body.status !== 'STORED') throw new Error('Relay did not return a final STORED confirmation.');
    this.database.transition(transferId, 'RELAY_VERIFIED', { relayVerified: true });
    this.database.transition(transferId, 'STORAGE_RECEIVING', { storageConfirmedByRelay: true });
    this.database.transition(transferId, 'STORED', { storageLocation: complete.body.storageKey || null });
    await fs.rm(ciphertextPath, { force: true });
    return complete.body;
  }

  async upload(request, response) {
    if (!this.rateLimit(request)) return publicError(response, 429, 'RATE_LIMITED');
    if (!this.assertPublicAuthentication(request)) return publicError(response, 401, 'UNAUTHORIZED');
    const declared = request.headers['content-length'];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > this.config.limits.maxUploadBytes)) {
      return publicError(response, 413, 'UPLOAD_TOO_LARGE');
    }
    const transferId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const originalFilename = sanitizeFilename(request.headers['x-file-name']);
    const rawContentType = request.headers['content-type'];
    const contentType = typeof rawContentType === 'string' && rawContentType.length <= 128 ? rawContentType.split(';')[0] : 'application/octet-stream';
    const dek = generateDek();
    let ciphertextPath;
    let workingCiphertextPath;
    try {
      const wrapped = await this.keyProvider.wrapDek(dek, fileId);
      this.database.createEncryptionDraft({
        transferId,
        fileId,
        originalFilename,
        contentType,
        sourceNode: 'server1',
        destinationNode: 'server3',
        chunkSize: this.config.limits.chunkSize,
        encryption: wrapped
      });
      ciphertextPath = safeStoragePath(this.config.storagePath, 'ciphertext', `${fileId}.bin`);
      workingCiphertextPath = `${ciphertextPath}.part`;
      const stats = await encryptStreamToFile({
        readable: request,
        outputPath: workingCiphertextPath,
        dek,
        fileId,
        transferId,
        transferChunkSize: this.config.limits.chunkSize,
        maxPlaintextBytes: this.config.limits.maxUploadBytes
      });
      await fs.rename(workingCiphertextPath, ciphertextPath);
      workingCiphertextPath = null;
      this.database.finalizeEncryption({ transferId, ...stats });
      const completion = await this.relayCiphertext(transferId, ciphertextPath);
      this.logger.info({ event: 'transfer_stored', transferId, fileId }, 'transfer stored');
      return sendJson(response, 201, { transferId, fileId, status: 'STORED', storageKey: completion.storageKey });
    } catch (error) {
      if (this.database.getTransfer(transferId)) this.database.forceFailure(transferId, error.message === 'UPLOAD_TOO_LARGE' ? 'UPLOAD_TOO_LARGE' : 'UPLOAD_OR_RELAY_FAILED');
      this.logger.warn({ event: 'transfer_failed', transferId, code: error.message === 'UPLOAD_TOO_LARGE' ? 'UPLOAD_TOO_LARGE' : 'UPLOAD_OR_RELAY_FAILED' }, 'transfer failed');
      if (workingCiphertextPath) await fs.rm(workingCiphertextPath, { force: true }).catch(() => undefined);
      if (ciphertextPath && error.message === 'UPLOAD_TOO_LARGE') await fs.rm(ciphertextPath, { force: true }).catch(() => undefined);
      return publicError(response, error.message === 'UPLOAD_TOO_LARGE' ? 413 : 502, error.message === 'UPLOAD_TOO_LARGE' ? 'UPLOAD_TOO_LARGE' : 'TRANSFER_PENDING_OR_FAILED');
    } finally {
      dek.fill(0);
    }
  }

  async resumePendingTransfers() {
    const candidates = this.database.listTransfersByStates(['FAILED', 'RECOVERY_PENDING', 'ENCRYPTED', 'RELAY_RECEIVING']);
    for (const candidate of candidates) {
      const ciphertextPath = safeStoragePath(this.config.storagePath, 'ciphertext', `${candidate.file_id}.bin`);
      const present = await fs.stat(ciphertextPath).then((entry) => entry.isFile()).catch(() => false);
      if (!present) continue;
      try {
        const current = this.database.getTransfer(candidate.transfer_id);
        if (current.state === 'FAILED' || current.state === 'RECOVERY_PENDING') {
          this.database.prepareForRecovery(candidate.transfer_id, 'ENCRYPTED', 'STARTUP_RESUME');
        }
        await this.relayCiphertext(candidate.transfer_id, ciphertextPath);
      } catch (_) {
        this.database.forceFailure(candidate.transfer_id, 'RESUME_RELAY_FAILED');
      }
    }
  }

  async runMaintenance() {
    const cutoff = Date.now() - this.config.limits.staleTransferHours * 60 * 60 * 1000;
    failStaleEncryptionDrafts(this.database, cutoff);
    await removeStalePartFiles(this.config.storagePath, cutoff);
    await this.resumePendingTransfers();
  }

  async health(request, response) {
    if (!this.assertPublicAuthentication(request)) return publicError(response, 401, 'UNAUTHORIZED');
    return sendJson(response, 200, await getHealthSnapshot(this.database, this.config.storagePath));
  }

  status(request, response, transferId) {
    if (!this.assertPublicAuthentication(request)) return publicError(response, 401, 'UNAUTHORIZED');
    const transfer = this.database.getTransfer(transferId);
    if (!transfer) return publicError(response, 404, 'NOT_FOUND');
    return sendJson(response, 200, {
      transferId: transfer.transfer_id,
      fileId: transfer.file_id,
      state: transfer.state,
      createdAt: transfer.created_at,
      completedAt: transfer.completed_at || null
    });
  }

  async handler(request, response) {
    try {
      const url = new URL(request.url, 'https://server1');
      if (request.method === 'GET' && url.pathname === '/health') return await this.health(request, response);
      if (request.method === 'POST' && url.pathname === '/upload') return await this.upload(request, response);
      const match = /^\/transfers\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (request.method === 'GET' && match) return this.status(request, response, match[1]);
      return publicError(response, 404, 'NOT_FOUND');
    } catch (_) {
      this.logger.error({ event: 'request_error' }, 'request processing failed');
      return publicError(response, 500, 'INTERNAL_ERROR');
    }
  }

  close() { this.database.close(); }
}

function startServer(config = loadNodeConfig('server1')) {
  const service = new UploadService(config);
  const server = https.createServer(createPublicTlsOptions(service.tlsMaterial), (request, response) => service.handler(request, response));
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

module.exports = { UploadService, startServer, asRemoteManifest };
