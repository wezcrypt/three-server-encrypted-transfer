'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const destination = path.resolve(process.env.DEV_CERT_DIR || path.join(__dirname, 'certs'));
const nodes = ['server1', 'server2', 'server3'];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
  throw new Error(`Certificate directory is not empty: ${destination}. Refusing to overwrite certificates.`);
}
fs.mkdirSync(destination, { recursive: true, mode: 0o700 });

const caKey = path.join(destination, 'ca.key.pem');
const caCert = path.join(destination, 'ca.cert.pem');
run('openssl', [
  'req', '-x509', '-new', '-nodes', '-newkey', 'rsa:4096', '-sha256', '-days', '365',
  '-keyout', caKey, '-out', caCert, '-subj', '/CN=three-server-dev-ca',
  '-addext', 'basicConstraints=critical,CA:TRUE',
  '-addext', 'keyUsage=critical,keyCertSign,cRLSign'
]);
fs.chmodSync(caKey, 0o600);

for (const node of nodes) {
  const key = path.join(destination, `${node}.key.pem`);
  const csr = path.join(destination, `${node}.csr.pem`);
  const cert = path.join(destination, `${node}.cert.pem`);
  const extension = path.join(destination, `${node}.ext.cnf`);
  fs.writeFileSync(extension, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=critical,serverAuth,clientAuth',
    `subjectAltName=DNS:${node},DNS:localhost,IP:127.0.0.1`,
    'subjectKeyIdentifier=hash',
    'authorityKeyIdentifier=keyid,issuer'
  ].join('\n'), { mode: 0o600 });
  run('openssl', [
    'req', '-new', '-nodes', '-newkey', 'rsa:3072', '-sha256',
    '-keyout', key, '-out', csr, '-subj', `/CN=${node}`
  ]);
  run('openssl', [
    'x509', '-req', '-in', csr, '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-out', cert, '-days', '180', '-sha256', '-extfile', extension
  ]);
  fs.rmSync(csr, { force: true });
  fs.rmSync(extension, { force: true });
  fs.chmodSync(key, 0o600);
  fs.chmodSync(cert, 0o644);
}
fs.chmodSync(caCert, 0o644);
process.stdout.write(`Development mTLS certificates created in ${destination}\n`);
