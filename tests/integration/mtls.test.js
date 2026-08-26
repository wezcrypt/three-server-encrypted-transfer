'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const path = require('node:path');
const {
  loadMtlsMaterial,
  createServerTlsOptions,
  verifyRequestPeer,
  mtlsRequest
} = require('../../shared/mtls');

const certDir = path.resolve(__dirname, '../../config/certs');
function material(node) {
  return loadMtlsMaterial({
    caPath: path.join(certDir, 'ca.cert.pem'),
    certPath: path.join(certDir, `${node}.cert.pem`),
    keyPath: path.join(certDir, `${node}.key.pem`)
  });
}

async function startServer() {
  const server = https.createServer(createServerTlsOptions(material('server2')), (request, response) => {
    const peer = verifyRequestPeer(request, 'server1');
    response.writeHead(peer.ok ? 200 : 403, { 'content-type': 'application/json' });
    response.end(JSON.stringify(peer));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('mTLS requires a trusted client and validates application identity', async (context) => {
  const server = await startServer();
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const response = await mtlsRequest({
    target: `https://localhost:${port}`,
    method: 'GET',
    path: '/',
    material: material('server1'),
    expectedIdentity: 'server2'
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body.toString('utf8')), { ok: true, code: null, identity: 'server1' });
});

test('mTLS response identity mismatch is rejected by the client', async (context) => {
  const server = await startServer();
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await assert.rejects(() => mtlsRequest({
    target: `https://localhost:${port}`,
    method: 'GET',
    path: '/',
    material: material('server1'),
    expectedIdentity: 'server3'
  }), /identity/i);
});


test('production mTLS configuration fails closed without a CRL', () => {
  assert.throws(() => loadMtlsMaterial({
    caPath: path.join(certDir, 'ca.cert.pem'),
    certPath: path.join(certDir, 'server1.cert.pem'),
    keyPath: path.join(certDir, 'server1.key.pem'),
    runtime: 'production'
  }), /CRL/);
});
