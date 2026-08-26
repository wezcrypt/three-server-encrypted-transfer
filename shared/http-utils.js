'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

function publicError(response, statusCode, code) {
  sendJson(response, statusCode, { error: code });
}

async function readJson(request, maxBytes = 128 * 1024) {
  let received = 0;
  const parts = [];
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxBytes) {
      request.destroy();
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    parts.push(chunk);
  }
  if (received === 0) throw new Error('REQUEST_BODY_EMPTY');
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (_) { throw new Error('REQUEST_BODY_INVALID_JSON'); }
}

function createRateLimiter({ windowMs = 60_000, maxRequests = 30 } = {}) {
  const buckets = new Map();
  return function allow(request) {
    const forwarded = request.socket.remoteAddress || 'unknown';
    const timestamp = Date.now();
    const bucket = buckets.get(forwarded) || { count: 0, reset: timestamp + windowMs };
    if (timestamp >= bucket.reset) { bucket.count = 0; bucket.reset = timestamp + windowMs; }
    bucket.count += 1;
    buckets.set(forwarded, bucket);
    if (buckets.size > 10_000) {
      for (const [key, value] of buckets) if (timestamp >= value.reset) buckets.delete(key);
    }
    return bucket.count <= maxRequests;
  };
}

function verifyBearer(request, expectedToken) {
  if (!expectedToken) return false;
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function safeStoragePath(root, ...components) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...components);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Unsafe storage path.');
  return candidate;
}

async function ensurePrivateDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fsp.chmod(directory, 0o700);
}

async function streamRequestToFile({ request, outputPath, maxBytes, expectedBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid maximum body size.');
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes)) {
    throw new Error('Invalid expected body size.');
  }
  await ensurePrivateDirectory(path.dirname(outputPath));
  const fd = await fsp.open(outputPath, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    for await (const item of request) {
      const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item);
      bytes += chunk.length;
      if (bytes > maxBytes || (expectedBytes !== undefined && bytes > expectedBytes)) {
        request.destroy();
        throw new Error('REQUEST_BODY_TOO_LARGE');
      }
      hash.update(chunk);
      await fd.write(chunk);
    }
    if (bytes === 0 || (expectedBytes !== undefined && bytes !== expectedBytes)) throw new Error('REQUEST_BODY_SIZE_MISMATCH');
    await fd.sync();
    return { bytes, sha256: hash.digest('hex') };
  } catch (error) {
    await fd.close();
    await fsp.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fd.close().catch(() => undefined);
  }
}

async function removeFileQuietly(filePath) {
  await fsp.rm(filePath, { force: true }).catch(() => undefined);
}

module.exports = {
  sendJson,
  publicError,
  readJson,
  createRateLimiter,
  verifyBearer,
  safeStoragePath,
  ensurePrivateDirectory,
  streamRequestToFile,
  removeFileQuietly
};
