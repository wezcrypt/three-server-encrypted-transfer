'use strict';

const { z } = require('zod');

const UUID = z.string().uuid();
const SHA256_HEX = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected SHA-256 hex digest.').transform((value) => value.toLowerCase());
const SAFE_LABEL = z.string().min(1).max(128).regex(/^[A-Za-z0-9._ -]+$/, 'Contains unsafe characters.');

const transferManifestSchema = z.object({
  transferId: UUID,
  fileId: UUID,
  originalFilename: SAFE_LABEL,
  contentType: z.string().min(1).max(128).default('application/octet-stream'),
  plaintextSize: z.number().int().nonnegative().max(1024 * 1024 * 1024 * 100),
  ciphertextSize: z.number().int().positive().max(1024 * 1024 * 1024 * 101),
  totalChunks: z.number().int().positive().max(131072),
  chunkSize: z.number().int().min(1024 * 1024).max(16 * 1024 * 1024),
  ciphertextSha256: SHA256_HEX,
  encryption: z.object({
    algorithm: z.literal('AES-256-GCM'),
    keyVersion: z.string().min(1).max(64),
    // Only opaque wrapped material may be supplied to Server 1's local DB.
    // Server 2 and Server 3 reject wrappedDek completely.
    wrappedDek: z.string().min(1).max(32768).optional(),
    aadVersion: z.literal('v1'),
    chunkIvBytes: z.literal(12),
    authTagBytes: z.literal(16)
  })
}).strict();

const remoteTransferManifestSchema = z.object({
  transferId: UUID,
  fileId: UUID,
  ciphertextSize: z.number().int().positive().max(1024 * 1024 * 1024 * 101),
  totalChunks: z.number().int().positive().max(131072),
  chunkSize: z.number().int().min(1024 * 1024).max(16 * 1024 * 1024),
  ciphertextSha256: SHA256_HEX,
  encryption: z.object({
    algorithm: z.literal('AES-256-GCM'),
    keyVersion: z.string().min(1).max(64),
    aadVersion: z.literal('v1'),
    chunkIvBytes: z.literal(12),
    authTagBytes: z.literal(16)
  }).strict()
}).strict();

const chunkDescriptorSchema = z.object({
  transferId: UUID,
  chunkIndex: z.number().int().nonnegative().max(131071),
  chunkSha256: SHA256_HEX,
  chunkSize: z.number().int().positive().max(16 * 1024 * 1024 + 28)
}).strict();

const nodeRegistrationSchema = z.object({
  nodeId: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  role: z.enum(['server1', 'server2', 'server3']),
  certificateIdentity: z.string().min(3).max(255)
}).strict();

function sanitizeFilename(filename) {
  if (typeof filename !== 'string') return 'upload.bin';
  const basename = filename.replaceAll('\\', '/').split('/').pop().replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const cleaned = basename.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'upload.bin';
}

module.exports = {
  transferManifestSchema,
  remoteTransferManifestSchema,
  chunkDescriptorSchema,
  nodeRegistrationSchema,
  sanitizeFilename,
  SHA256_HEX
};
