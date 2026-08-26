'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer: startServer1 } = require('../../server1-upload');
const { startServer: startServer2 } = require('../../server2-relay');
const { startServer: startServer3 } = require('../../server3-storage');

const certDir = path.resolve(__dirname, '../../config/certs');

function tls(node) {
  return {
    caPath: path.join(certDir, 'ca.cert.pem'),
    certPath: path.join(certDir, `${node}.cert.pem`),
    keyPath: path.join(certDir, `${node}.key.pem`)
  };
}

function waitListening(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
  });
}

function closeServer(instance) {
  return new Promise((resolve) => instance.server.close(() => { instance.service.close(); resolve(); }));
}

function upload({ port, source }) {
  const ca = require('node:fs').readFileSync(path.join(certDir, 'ca.cert.pem'));
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'localhost',
      port,
      path: '/upload',
      method: 'POST',
      ca,
      rejectUnauthorized: true,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(source.length),
        'x-file-name': '../sensitive.txt'
      }
    }, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(parts).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(source);
  });
}

test('end-to-end transfer stores only ciphertext on Server 2 and Server 3', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'three-server-test-'));
  const previous = { MASTER_KEY_B64: process.env.MASTER_KEY_B64, KEY_PROVIDER: process.env.KEY_PROVIDER, RUNTIME_ENV: process.env.RUNTIME_ENV };
  process.env.MASTER_KEY_B64 = crypto.randomBytes(32).toString('base64');
  process.env.KEY_PROVIDER = 'development';
  process.env.RUNTIME_ENV = 'development';
  let one; let two; let three;
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (one) await closeServer(one);
    if (two) await closeServer(two);
    if (three) await closeServer(three);
    await fs.rm(root, { recursive: true, force: true });
  });

  const limits = { maxUploadBytes: 8 * 1024 * 1024, chunkSize: 1024 * 1024, requestTimeoutMs: 30_000, staleTransferHours: 6 };
  const config3 = { runtime: 'development', nodeId: 'server3', bindHost: '127.0.0.1', port: 0, databasePath: path.join(root, 's3.sqlite'), storagePath: path.join(root, 's3'), tls: tls('server3'), limits };
  three = startServer3(config3);
  await waitListening(three.server);
  const config2 = { runtime: 'development', nodeId: 'server2', bindHost: '127.0.0.1', port: 0, databasePath: path.join(root, 's2.sqlite'), storagePath: path.join(root, 's2'), tls: tls('server2'), storageUrl: `https://localhost:${three.server.address().port}`, limits };
  two = startServer2(config2);
  await waitListening(two.server);
  const config1 = { runtime: 'development', nodeId: 'server1', bindHost: '127.0.0.1', port: 0, databasePath: path.join(root, 's1.sqlite'), storagePath: path.join(root, 's1'), tls: tls('server1'), relayUrl: `https://localhost:${two.server.address().port}`, limits };
  one = startServer1(config1);
  await waitListening(one.server);

  const source = crypto.randomBytes(2_500_000);
  const response = await upload({ port: one.server.address().port, source });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.status, 'STORED');
  const server1Transfer = one.service.database.getTransfer(response.body.transferId);
  const server2Transfer = two.service.database.getTransfer(response.body.transferId);
  const server3Transfer = three.service.database.getTransfer(response.body.transferId);
  assert.equal(server1Transfer.state, 'STORED');
  assert.equal(server2Transfer.state, 'STORED');
  assert.equal(server3Transfer.state, 'STORED');
  assert.ok(server1Transfer.wrapped_dek);
  assert.equal(server2Transfer.wrapped_dek, null);
  assert.equal(server3Transfer.wrapped_dek, null);
  assert.match(response.body.storageKey, new RegExp(`^files/${response.body.fileId}$`));
  const chunkDirectory = path.join(root, 's3', response.body.storageKey, 'chunks');
  const names = (await fs.readdir(chunkDirectory)).sort();
  const ciphertext = Buffer.concat(await Promise.all(names.map((name) => fs.readFile(path.join(chunkDirectory, name)))));
  assert.notDeepEqual(ciphertext, source);
  assert.equal(await fs.stat(path.join(root, 's2', 'relay', response.body.transferId)).then(() => true).catch(() => false), false);
  assert.equal(server2Transfer.original_filename, `opaque-${response.body.fileId}`);
  assert.notEqual(server2Transfer.original_filename, '../sensitive.txt');
});


async function reservePort() {
  const net = require('node:net');
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('Server 1 resumes a failed transfer after Storage returns without deleting ciphertext early', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'three-server-resume-'));
  const previous = { MASTER_KEY_B64: process.env.MASTER_KEY_B64, KEY_PROVIDER: process.env.KEY_PROVIDER, RUNTIME_ENV: process.env.RUNTIME_ENV };
  process.env.MASTER_KEY_B64 = crypto.randomBytes(32).toString('base64');
  process.env.KEY_PROVIDER = 'development';
  process.env.RUNTIME_ENV = 'development';
  let one; let two; let three;
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (one) await closeServer(one);
    if (two) await closeServer(two);
    if (three) await closeServer(three);
    await fs.rm(root, { recursive: true, force: true });
  });

  const limits = { maxUploadBytes: 8 * 1024 * 1024, chunkSize: 1024 * 1024, requestTimeoutMs: 2_000, staleTransferHours: 6 };
  const storagePort = await reservePort();
  const config2 = { runtime: 'development', nodeId: 'server2', bindHost: '127.0.0.1', port: 0, databasePath: path.join(root, 's2.sqlite'), storagePath: path.join(root, 's2'), tls: tls('server2'), storageUrl: `https://localhost:${storagePort}`, limits };
  two = startServer2(config2);
  await waitListening(two.server);
  const config1 = { runtime: 'development', nodeId: 'server1', bindHost: '127.0.0.1', port: 0, databasePath: path.join(root, 's1.sqlite'), storagePath: path.join(root, 's1'), tls: tls('server1'), relayUrl: `https://localhost:${two.server.address().port}`, limits };
  one = startServer1(config1);
  await waitListening(one.server);

  const source = crypto.randomBytes(1_500_000);
  const failed = await upload({ port: one.server.address().port, source });
  assert.equal(failed.statusCode, 502);
  const transferId = one.service.database.listTransfersByStates(['FAILED'])[0].transfer_id;
  const localBefore = one.service.database.getTransfer(transferId);
  const ciphertextPath = path.join(root, 's1', 'ciphertext', `${localBefore.file_id}.bin`);
  assert.equal(await fs.stat(ciphertextPath).then(() => true), true);

  const config3 = { runtime: 'development', nodeId: 'server3', bindHost: '127.0.0.1', port: storagePort, databasePath: path.join(root, 's3.sqlite'), storagePath: path.join(root, 's3'), tls: tls('server3'), limits };
  three = startServer3(config3);
  await waitListening(three.server);
  await one.service.resumePendingTransfers();

  const recoveredOne = one.service.database.getTransfer(transferId);
  const recoveredTwo = two.service.database.getTransfer(transferId);
  const recoveredThree = three.service.database.getTransfer(transferId);
  assert.equal(recoveredOne.state, 'STORED');
  assert.equal(recoveredTwo.state, 'STORED');
  assert.equal(recoveredThree.state, 'STORED');
  assert.equal(await fs.stat(ciphertextPath).then(() => true).catch(() => false), false);
});
