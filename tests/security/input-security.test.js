'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { safeStoragePath } = require('../../shared/http-utils');
const { chunkDescriptorSchema, sanitizeFilename } = require('../../shared/validation');

const transferId = 'a2590d1a-7a4f-4cfe-84da-890760b161b4';

test('file names are metadata-only and storage paths reject traversal', () => {
  assert.equal(sanitizeFilename('../../private/secret.txt'), 'secret.txt');
  assert.equal(sanitizeFilename('..\\..\\secret.txt'), 'secret.txt');
  assert.throws(() => safeStoragePath('/var/lib/transfer', '..', 'outside'), /Unsafe/);
  assert.equal(safeStoragePath('/var/lib/transfer', 'files', 'fixed-id'), path.resolve('/var/lib/transfer/files/fixed-id'));
});

test('chunk metadata rejects oversized and malformed requests', () => {
  assert.throws(() => chunkDescriptorSchema.parse({ transferId, chunkIndex: -1, chunkSha256: 'a'.repeat(64), chunkSize: 1 }), /Number/);
  assert.throws(() => chunkDescriptorSchema.parse({ transferId, chunkIndex: 0, chunkSha256: 'g'.repeat(64), chunkSize: 1024 }), /SHA/);
  assert.throws(() => chunkDescriptorSchema.parse({ transferId, chunkIndex: 0, chunkSha256: 'a'.repeat(64), chunkSize: 16 * 1024 * 1024 + 29 }), /Number/);
});
