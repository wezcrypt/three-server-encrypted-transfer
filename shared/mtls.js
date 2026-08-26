'use strict';

const fs = require('node:fs');
const https = require('node:https');
const tls = require('node:tls');

const TLS_MIN_VERSION = 'TLSv1.3';
const ALLOWED_NODE_IDENTITIES = new Set(['server1', 'server2', 'server3']);

function readPem(filePath, label, { privateKey = false } = {}) {
  if (!filePath) throw new Error(`Missing ${label} path.`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${label} path is not a regular file.`);
  if (privateKey && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('mTLS private key permissions must be 0600 or stricter.');
  }
  return fs.readFileSync(filePath);
}

function loadMtlsMaterial({ caPath, certPath, keyPath, crlPath, runtime = process.env.RUNTIME_ENV || 'development' }) {
  if (runtime === 'production' && !crlPath) throw new Error('Production mTLS requires MTLS_CRL_PATH for certificate revocation.');
  const material = {
    ca: readPem(caPath, 'CA certificate'),
    cert: readPem(certPath, 'node certificate'),
    key: readPem(keyPath, 'private key', { privateKey: true })
  };
  if (crlPath) material.crl = readPem(crlPath, 'certificate revocation list');
  return material;
}

function createServerTlsOptions(material) {
  return {
    ...material,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: TLS_MIN_VERSION,
    honorCipherOrder: true,
    ciphers: tls.DEFAULT_CIPHERS
  };
}

function createPublicTlsOptions(material) {
  return {
    cert: material.cert,
    key: material.key,
    minVersion: TLS_MIN_VERSION,
    honorCipherOrder: true,
    ciphers: tls.DEFAULT_CIPHERS
  };
}

function createClientTlsOptions(material, servername) {
  if (!servername) throw new Error('mTLS client requires an expected servername.');
  return {
    ...material,
    servername,
    rejectUnauthorized: true,
    minVersion: TLS_MIN_VERSION,
    honorCipherOrder: true,
    ciphers: tls.DEFAULT_CIPHERS
  };
}

function certMatchesIdentity(certificate, expectedIdentity) {
  if (!ALLOWED_NODE_IDENTITIES.has(expectedIdentity) || !certificate || !certificate.subject) return false;
  const commonName = certificate.subject.CN;
  if (commonName === expectedIdentity) return true;
  const sans = String(certificate.subjectaltname || '').split(',').map((item) => item.trim());
  return sans.includes(`DNS:${expectedIdentity}`);
}

function getPeerIdentity(socket) {
  const certificate = socket.getPeerCertificate(true);
  if (!certificate || !certificate.subject) return null;
  for (const identity of ALLOWED_NODE_IDENTITIES) {
    if (certMatchesIdentity(certificate, identity)) return identity;
  }
  return null;
}

function verifyRequestPeer(request, expectedIdentity) {
  const socket = request.socket;
  if (!socket || !socket.encrypted || socket.authorized !== true) {
    return { ok: false, code: 'MTLS_UNAUTHORIZED', identity: null };
  }
  const identity = getPeerIdentity(socket);
  if (identity !== expectedIdentity) {
    return { ok: false, code: 'MTLS_IDENTITY_MISMATCH', identity };
  }
  return { ok: true, code: null, identity };
}

function verifyResponsePeer(responseSocket, expectedIdentity) {
  if (!responseSocket || !responseSocket.encrypted || responseSocket.authorized !== true) {
    throw new Error('mTLS server certificate was not authorized.');
  }
  const identity = getPeerIdentity(responseSocket);
  if (identity !== expectedIdentity) throw new Error('mTLS server identity did not match the expected node.');
}

function mtlsRequest({ target, method, path, headers = {}, material, expectedIdentity, body, timeoutMs = 30000 }) {
  const url = new URL(target);
  if (url.protocol !== 'https:') throw new Error('Internal node target must use https.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('Invalid mTLS request timeout.');
  const tlsOptions = createClientTlsOptions(material, url.hostname);
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      method,
      path,
      headers,
      timeout: timeoutMs,
      ...tlsOptions
    }, (response) => {
      try { verifyResponsePeer(response.socket, expectedIdentity); } catch (error) { response.resume(); reject(error); return; }
      const parts = [];
      let received = 0;
      const limit = 1024 * 1024;
      response.on('data', (part) => {
        received += part.length;
        if (received > limit) response.destroy(new Error('Internal response exceeds permitted size.'));
        else parts.push(part);
      });
      response.on('error', reject);
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(parts)
      }));
    });
    request.on('timeout', () => request.destroy(new Error('Internal mTLS request timed out.')));
    request.on('error', reject);
    if (body) request.end(body); else request.end();
  });
}

module.exports = {
  TLS_MIN_VERSION,
  loadMtlsMaterial,
  createServerTlsOptions,
  createPublicTlsOptions,
  createClientTlsOptions,
  certMatchesIdentity,
  getPeerIdentity,
  verifyRequestPeer,
  verifyResponsePeer,
  mtlsRequest
};
