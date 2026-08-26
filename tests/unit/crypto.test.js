'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encryptChunk, decryptChunk, generateDek } = require('../../shared/crypto');

const fileId = 'e6eecb56-7d01-4413-9602-442e3bd1d12d';
const transferId = 'a2590d1a-7a4f-4cfe-84da-890760b161b4';
const ivPrefix = Buffer.from('12345678');

test('AES-256-GCM record decrypts only with matching context', () => {
  const dek = generateDek();
  const plaintext = crypto.randomBytes(64 * 1024);
  const record = encryptChunk({ plaintext, dek, fileId, transferId, chunkIndex: 0, ivPrefix });
  const recovered = decryptChunk({ record, dek, fileId, transferId, chunkIndex: 0 });
  assert.deepEqual(recovered, plaintext);
  assert.throws(() => decryptChunk({ record, dek, fileId, transferId, chunkIndex: 1 }), /authenticate|Unsupported state/i);
});

test('tampering with any authenticated ciphertext record fails', () => {
  const dek = generateDek();
  const record = encryptChunk({ plaintext: Buffer.from('sensitive payload'), dek, fileId, transferId, chunkIndex: 0, ivPrefix });
  record[record.length - 1] ^= 0x01;
  assert.throws(() => decryptChunk({ record, dek, fileId, transferId, chunkIndex: 0 }), /authenticate|Unsupported state/i);
});

test('per-chunk IVs are unique for a single DEK', () => {
  const dek = generateDek();
  const first = encryptChunk({ plaintext: Buffer.from('one'), dek, fileId, transferId, chunkIndex: 0, ivPrefix });
  const second = encryptChunk({ plaintext: Buffer.from('two'), dek, fileId, transferId, chunkIndex: 1, ivPrefix });
  assert.notDeepEqual(first.subarray(0, 12), second.subarray(0, 12));
});
