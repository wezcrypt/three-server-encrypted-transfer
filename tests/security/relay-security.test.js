'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer: startRelay } = require('../../server2-relay');
const { loadMtlsMaterial, mtlsRequest } = require('../../shared/mtls');

const certDir = path.resolve(__dirname, '../../config/certs');
function tls(node) {
  return { caPath: path.join(certDir, 'ca.cert.pem'), certPath: path.join(certDir, `${node}.cert.pem`), keyPath: path.join(certDir, `${node}.key.pem`) };
}
function material(node) { return loadMtlsMaterial({ ...tls(node), runtime: 'development' }); }
function waitListening(server) { return new Promise((resolve, reject) => { server.once('error', reject); server.once('listening', resolve); }); }
function postManifest(target, materialValue, manifest) {
  const body = Buffer.from(JSON.stringify(manifest));
  return mtlsRequest({ target, method: 'POST', path: '/internal/transfers', headers: { 'content-type': 'application/json', 'content-length': String(body.length) }, body, material: materialValue, expectedIdentity: 'server2' });
}

test('Relay rejects an unauthorized node and conflicting manifest replay', async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'relay-security-'));
  const relay = startRelay({
    runtime: 'development', nodeId: 'server2', bindHost: '127.0.0.1', port: 0,
    databasePath: path.join(root, 'relay.sqlite'), storagePath: path.join(root, 'relay-files'), tls: tls('server2'),
    storageUrl: 'https://localhost:1', limits: { maxUploadBytes: 8 * 1024 * 1024, chunkSize: 1024 * 1024, requestTimeoutMs: 5_000, staleTransferHours: 6 }
  });
  await waitListening(relay.server);
  context.after(async () => {
    clearInterval(relay.recoveryTimer);
    await new Promise((resolve) => relay.server.close(resolve));
    relay.service.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const target = `https://localhost:${relay.server.address().port}`;
  const manifest = {
    transferId: crypto.randomUUID(), fileId: crypto.randomUUID(), ciphertextSize: 1024, totalChunks: 1, chunkSize: 1024 * 1024,
    ciphertextSha256: 'a'.repeat(64),
    encryption: { algorithm: 'AES-256-GCM', keyVersion: 'v1', aadVersion: 'v1', chunkIvBytes: 12, authTagBytes: 16 }
  };

  const unauthorized = await postManifest(target, material('server3'), manifest);
  assert.equal(unauthorized.statusCode, 403);
  const accepted = await postManifest(target, material('server1'), manifest);
  assert.equal(accepted.statusCode, 201);
  const conflicting = { ...manifest, ciphertextSha256: 'b'.repeat(64) };
  const replay = await postManifest(target, material('server1'), conflicting);
  assert.equal(replay.statusCode, 409);
});
