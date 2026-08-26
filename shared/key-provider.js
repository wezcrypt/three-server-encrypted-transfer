'use strict';

const crypto = require('node:crypto');

const WRAP_AAD_PREFIX = 'three-server-transfer:dek-wrap:v1';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function decodeMasterKey() {
  const value = requireEnv('MASTER_KEY_B64');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('MASTER_KEY_B64 must decode to exactly 32 bytes.');
  return key;
}

function wrapAad(fileId, version) {
  return Buffer.from(`${WRAP_AAD_PREFIX}|${fileId}|${version}`, 'utf8');
}

class DevelopmentKeyProvider {
  constructor() {
    this.keyVersion = process.env.DEV_KMS_KEY_VERSION || 'v1';
    this.keys = new Map();
    const configuredKeys = process.env.DEV_KMS_KEYS_JSON;
    if (configuredKeys) {
      let parsed;
      try { parsed = JSON.parse(configuredKeys); } catch (_) { throw new Error('DEV_KMS_KEYS_JSON must be valid JSON.'); }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('DEV_KMS_KEYS_JSON must be an object.');
      for (const [version, encodedKey] of Object.entries(parsed)) {
        if (!/^v[0-9]+$/.test(version) || typeof encodedKey !== 'string') throw new Error('DEV_KMS_KEYS_JSON contains an invalid key version.');
        const key = Buffer.from(encodedKey, 'base64');
        if (key.length !== 32) throw new Error(`Development key ${version} must decode to 32 bytes.`);
        this.keys.set(version, key);
      }
    } else {
      this.keys.set(this.keyVersion, decodeMasterKey());
    }
    if (!this.keys.has(this.keyVersion)) throw new Error('DEV_KMS_KEY_VERSION is missing from DEV_KMS_KEYS_JSON.');
  }

  async wrapDek(dek, fileId) {
    if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('DEK must be a 32-byte buffer.');
    const activeKey = this.keys.get(this.keyVersion);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', activeKey, iv, { authTagLength: 16 });
    cipher.setAAD(wrapAad(fileId, this.keyVersion));
    const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      keyVersion: this.keyVersion,
      wrappedDek: `dev:${this.keyVersion}:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
    };
  }

  async unwrapDek(wrappedDek, fileId) {
    const parts = String(wrappedDek).split(':');
    if (parts.length !== 5 || parts[0] !== 'dev') throw new Error('Invalid development wrapped DEK format.');
    const [, version, ivEncoded, tagEncoded, encryptedEncoded] = parts;
    const key = this.keys.get(version);
    if (!key) throw new Error('Requested DEK key version is not available.');
    const iv = Buffer.from(ivEncoded, 'base64url');
    const tag = Buffer.from(tagEncoded, 'base64url');
    const encrypted = Buffer.from(encryptedEncoded, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length !== 32) throw new Error('Invalid wrapped DEK lengths.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(wrapAad(fileId, version));
    decipher.setAuthTag(tag);
    const dek = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    if (dek.length !== 32) throw new Error('Unwrapped DEK has an invalid length.');
    return dek;
  }
}

class VaultTransitKeyProvider {
  constructor() {
    this.address = requireEnv('VAULT_ADDR').replace(/\/$/, '');
    this.token = requireEnv('VAULT_TOKEN');
    this.transitKey = requireEnv('VAULT_TRANSIT_KEY');
    this.timeoutMs = Number.parseInt(process.env.VAULT_TIMEOUT_MS || '5000', 10);
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 30000) {
      throw new Error('VAULT_TIMEOUT_MS must be between 1000 and 30000.');
    }
  }

  async request(action, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.address}/v1/transit/${action}/${encodeURIComponent(this.transitKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vault-Token': this.token
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Vault Transit request failed with status ${response.status}.`);
      const body = await response.json();
      if (!body || !body.data) throw new Error('Vault Transit response did not contain data.');
      return body.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async wrapDek(dek, fileId) {
    if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('DEK must be a 32-byte buffer.');
    const context = Buffer.from(fileId, 'utf8').toString('base64');
    const data = await this.request('encrypt', { plaintext: dek.toString('base64'), context });
    if (typeof data.ciphertext !== 'string' || !/^vault:v\d+:.+/.test(data.ciphertext)) throw new Error('Vault returned an invalid ciphertext.');
    const match = /^vault:(v\d+):/.exec(data.ciphertext);
    return { keyVersion: match[1], wrappedDek: data.ciphertext };
  }

  async unwrapDek(wrappedDek, fileId) {
    if (typeof wrappedDek !== 'string' || !/^vault:v\d+:.+/.test(wrappedDek)) throw new Error('Invalid Vault wrapped DEK format.');
    const context = Buffer.from(fileId, 'utf8').toString('base64');
    const data = await this.request('decrypt', { ciphertext: wrappedDek, context });
    const dek = Buffer.from(data.plaintext || '', 'base64');
    if (dek.length !== 32) throw new Error('Vault returned an invalid DEK.');
    return dek;
  }
}

function createKeyProvider({ runtime = process.env.RUNTIME_ENV || 'development' } = {}) {
  const provider = process.env.KEY_PROVIDER || (runtime === 'production' ? 'vault' : 'development');
  if (runtime === 'production' && provider !== 'vault') {
    throw new Error('Production requires KEY_PROVIDER=vault; development key storage is prohibited.');
  }
  if (provider === 'vault') return new VaultTransitKeyProvider();
  if (provider === 'development') return new DevelopmentKeyProvider();
  throw new Error('Unsupported KEY_PROVIDER.');
}

module.exports = {
  DevelopmentKeyProvider,
  VaultTransitKeyProvider,
  createKeyProvider
};
