'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { finished } = require('node:stream/promises');

const ALGORITHM = 'aes-256-gcm';
const DEK_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const OVERHEAD_BYTES = IV_BYTES + AUTH_TAG_BYTES;
const AAD_VERSION = 'v1';

function generateDek() {
  return crypto.randomBytes(DEK_BYTES);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildChunkAad({ fileId, transferId, chunkIndex, plaintextLength }) {
  return Buffer.from(`three-server-transfer|${AAD_VERSION}|${fileId}|${transferId}|${chunkIndex}|${plaintextLength}`, 'utf8');
}

function makeUniqueIv(prefix, chunkIndex) {
  if (!Buffer.isBuffer(prefix) || prefix.length !== 8) throw new Error('IV prefix must be exactly 8 bytes.');
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 0xffffffff) throw new Error('Chunk index cannot be encoded in IV.');
  const iv = Buffer.allocUnsafe(IV_BYTES);
  prefix.copy(iv, 0);
  iv.writeUInt32BE(chunkIndex, 8);
  return iv;
}

function encryptChunk({ plaintext, dek, fileId, transferId, chunkIndex, ivPrefix }) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length === 0) throw new Error('Cannot encrypt an empty chunk.');
  if (!Buffer.isBuffer(dek) || dek.length !== DEK_BYTES) throw new Error('Invalid DEK.');
  const iv = makeUniqueIv(ivPrefix, chunkIndex);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(buildChunkAad({ fileId, transferId, chunkIndex, plaintextLength: plaintext.length }));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decryptChunk({ record, dek, fileId, transferId, chunkIndex }) {
  if (!Buffer.isBuffer(record) || record.length <= OVERHEAD_BYTES) throw new Error('Ciphertext record is malformed.');
  if (!Buffer.isBuffer(dek) || dek.length !== DEK_BYTES) throw new Error('Invalid DEK.');
  const iv = record.subarray(0, IV_BYTES);
  const tag = record.subarray(IV_BYTES, OVERHEAD_BYTES);
  const ciphertext = record.subarray(OVERHEAD_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(buildChunkAad({ fileId, transferId, chunkIndex, plaintextLength: ciphertext.length }));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve, reject) => {
      stream.once('drain', resolve);
      stream.once('error', reject);
    });
  }
}

/**
 * Encrypts a readable source to a temporary ciphertext file.  There is no
 * plaintext file written by this function. Each ciphertext record becomes one
 * network transfer chunk, with its own unique GCM IV and authentication tag.
 */
async function encryptStreamToFile({ readable, outputPath, dek, fileId, transferId, transferChunkSize, maxPlaintextBytes = Number.MAX_SAFE_INTEGER }) {
  if (!Number.isInteger(transferChunkSize) || transferChunkSize <= OVERHEAD_BYTES) {
    throw new Error('Transfer chunk size is too small for AES-GCM framing.');
  }
  const plaintextChunkSize = transferChunkSize - OVERHEAD_BYTES;
  const parent = path.dirname(outputPath);
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  const digest = crypto.createHash('sha256');
  const ivPrefix = crypto.randomBytes(8);
  let leftover = Buffer.alloc(0);
  let chunkIndex = 0;
  let plaintextSize = 0;
  let ciphertextSize = 0;

  try {
    for await (const sourceChunk of readable) {
      const incoming = Buffer.isBuffer(sourceChunk) ? sourceChunk : Buffer.from(sourceChunk);
      plaintextSize += incoming.length;
      if (plaintextSize > maxPlaintextBytes) {
        readable.destroy(new Error('UPLOAD_TOO_LARGE'));
        throw new Error('UPLOAD_TOO_LARGE');
      }
      let pending = leftover.length === 0 ? incoming : Buffer.concat([leftover, incoming]);
      while (pending.length >= plaintextChunkSize) {
        const plaintext = pending.subarray(0, plaintextChunkSize);
        pending = pending.subarray(plaintextChunkSize);
        const record = encryptChunk({ plaintext, dek, fileId, transferId, chunkIndex, ivPrefix });
        await writeChunk(output, record);
        digest.update(record);
        ciphertextSize += record.length;
        chunkIndex += 1;
      }
      leftover = pending;
    }
    if (leftover.length > 0) {
      const record = encryptChunk({ plaintext: leftover, dek, fileId, transferId, chunkIndex, ivPrefix });
      await writeChunk(output, record);
      digest.update(record);
      ciphertextSize += record.length;
      chunkIndex += 1;
    }
    if (chunkIndex === 0) throw new Error('Empty uploads are not supported.');
    output.end();
    await finished(output);
    return {
      plaintextSize,
      ciphertextSize,
      totalChunks: chunkIndex,
      ciphertextSha256: digest.digest('hex'),
      plaintextChunkSize
    };
  } catch (error) {
    output.destroy();
    await fsp.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function *readFixedChunks(filePath, chunkSize) {
  const handle = await fsp.open(filePath, 'r');
  try {
    let position = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      yield buffer.subarray(0, bytesRead);
      if (bytesRead < chunkSize) break;
    }
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) digest.update(chunk);
  return digest.digest('hex');
}

module.exports = {
  ALGORITHM,
  DEK_BYTES,
  IV_BYTES,
  AUTH_TAG_BYTES,
  OVERHEAD_BYTES,
  AAD_VERSION,
  generateDek,
  sha256,
  buildChunkAad,
  encryptChunk,
  decryptChunk,
  encryptStreamToFile,
  readFixedChunks,
  hashFile
};
