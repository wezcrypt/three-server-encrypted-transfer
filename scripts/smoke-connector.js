'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const executable = path.join(root, 'dist', isWindows ? 'three-server-connector-win-x64.exe' : 'three-server-connector-linux-x64');
const certificates = path.join(root, 'config', 'certs');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'three-server-connector-smoke-'));
const workspace = path.join(temporaryRoot, 'workspace');
const configPath = path.join(temporaryRoot, 'connector.json');

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`${label} is missing: ${filePath}`);
}

function port(base) {
  return base + Math.floor(Math.random() * 1000);
}

async function main() {
  requireFile(executable, 'Packaged Connector executable');
  for (const name of ['ca.cert.pem', 'server1.cert.pem', 'server1.key.pem', 'server2.cert.pem', 'server2.key.pem', 'server3.cert.pem', 'server3.key.pem']) {
    requireFile(path.join(certificates, name), `Development certificate ${name}`);
  }

  const basePort = port(32000);
  const config = {
    language: 'en',
    runtime: 'development',
    workspace,
    commonCaPath: path.join(certificates, 'ca.cert.pem'),
    node: {
      server1: {
        bindHost: '127.0.0.1', publicHost: '127.0.0.1', port: basePort,
        certPath: path.join(certificates, 'server1.cert.pem'), keyPath: path.join(certificates, 'server1.key.pem'), storagePath: path.join(workspace, 'server1')
      },
      server2: {
        bindHost: '127.0.0.1', publicHost: '127.0.0.1', port: basePort + 1,
        certPath: path.join(certificates, 'server2.cert.pem'), keyPath: path.join(certificates, 'server2.key.pem'), storagePath: path.join(workspace, 'server2')
      },
      server3: {
        bindHost: '127.0.0.1', publicHost: '127.0.0.1', port: basePort + 2,
        certPath: path.join(certificates, 'server3.cert.pem'), keyPath: path.join(certificates, 'server3.key.pem'), storagePath: path.join(workspace, 'server3')
      }
    },
    uploadToken: 'smoke-test-token-must-have-at-least-32-characters',
    limits: { maxUploadBytes: 16 * 1024 * 1024, chunkSize: 1024 * 1024, requestTimeoutMs: 5000, staleTransferHours: 1 }
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  let output = '';
  const child = spawn(executable, ['--config', configPath], { cwd: root, windowsHide: true });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const started = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Packaged Connector did not start within 20 seconds. Output:\n${output}`)), 20000);
    const check = () => {
      if (output.includes('Connector started all nodes.')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Packaged Connector exited before startup (code=${code}, signal=${signal}). Output:\n${output}`));
    });
  });

  await started;
  child.kill(isWindows ? undefined : 'SIGTERM');
  const result = await exit;
  fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });

  if (!isWindows && result.code !== 0 && result.signal !== 'SIGTERM' && result.signal !== 'SIGINT') {
    throw new Error(`Packaged Connector stopped unexpectedly (code=${result.code}, signal=${result.signal}). Output:\n${output}`);
  }
  process.stdout.write('Packaged Connector smoke test passed.\n');
}

main().catch((error) => {
  try { fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
