'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertTransition, isTerminal } = require('./states');

function now() {
  return new Date().toISOString();
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

class TransferDatabase {
  constructor(databasePath, migrationDirectory) {
    ensureParentDirectory(databasePath);
    this.db = new Database(databasePath, { fileMustExist: false, timeout: 5000 });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.applyMigrations(migrationDirectory);
  }

  applyMigrations(migrationDirectory) {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const files = fs.readdirSync(migrationDirectory)
      .filter((entry) => /^\d+_.+\.sql$/.test(entry))
      .sort();
    const isApplied = this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    const insert = this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
    for (const filename of files) {
      if (isApplied.get(filename)) continue;
      const migration = fs.readFileSync(path.join(migrationDirectory, filename), 'utf8');
      this.db.transaction(() => {
        this.db.exec(migration);
        insert.run(filename, now());
      })();
    }
  }

  registerNode(node) {
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO nodes (node_id, role, certificate_identity, active, created_at, updated_at)
      VALUES (@nodeId, @role, @certificateIdentity, 1, @timestamp, @timestamp)
      ON CONFLICT(node_id) DO UPDATE SET
        role = excluded.role,
        certificate_identity = excluded.certificate_identity,
        active = 1,
        updated_at = excluded.updated_at
    `).run({ ...node, timestamp });
  }

  createTransfer({ manifest, state, sourceNode, destinationNode, storageKey = null, includeWrappedDek = false }) {
    const timestamp = now();
    const execute = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT transfer_id FROM transfers WHERE transfer_id = ?').get(manifest.transferId);
      if (existing) return false;
      this.db.prepare(`
        INSERT INTO files (file_id, original_filename, content_type, plaintext_size, ciphertext_size, ciphertext_sha256, storage_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        manifest.fileId,
        manifest.originalFilename,
        manifest.contentType,
        manifest.plaintextSize,
        manifest.ciphertextSize,
        manifest.ciphertextSha256,
        storageKey,
        timestamp,
        timestamp
      );
      this.db.prepare(`
        INSERT INTO transfers (transfer_id, file_id, state, source_node, destination_node, chunk_size, total_chunks, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(manifest.transferId, manifest.fileId, state, sourceNode, destinationNode, manifest.chunkSize, manifest.totalChunks, timestamp, timestamp);
      this.db.prepare(`
        INSERT INTO encryption_metadata (file_id, algorithm, key_version, wrapped_dek, aad_version, iv_bytes, tag_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        manifest.fileId,
        manifest.encryption.algorithm,
        manifest.encryption.keyVersion,
        includeWrappedDek ? manifest.encryption.wrappedDek : null,
        manifest.encryption.aadVersion,
        manifest.encryption.chunkIvBytes,
        manifest.encryption.authTagBytes,
        timestamp
      );
      this.recordEvent(manifest.transferId, 'TRANSFER_CREATED', {
        state,
        sourceNode,
        destinationNode,
        totalChunks: manifest.totalChunks
      });
      return true;
    });
    return execute();
  }

  createEncryptionDraft({ transferId, fileId, originalFilename, contentType, sourceNode, destinationNode, chunkSize, encryption }) {
    const timestamp = now();
    const execute = this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM transfers WHERE transfer_id = ?').get(transferId)) throw new Error('Transfer already exists.');
      this.db.prepare(`
        INSERT INTO files (file_id, original_filename, content_type, plaintext_size, ciphertext_size, ciphertext_sha256, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, ?, ?, ?)
      `).run(fileId, originalFilename, contentType, '0'.repeat(64), timestamp, timestamp);
      this.db.prepare(`
        INSERT INTO transfers (transfer_id, file_id, state, source_node, destination_node, chunk_size, total_chunks, created_at, updated_at)
        VALUES (?, ?, 'ENCRYPTING', ?, ?, ?, 1, ?, ?)
      `).run(transferId, fileId, sourceNode, destinationNode, chunkSize, timestamp, timestamp);
      this.db.prepare(`
        INSERT INTO encryption_metadata (file_id, algorithm, key_version, wrapped_dek, aad_version, iv_bytes, tag_bytes, created_at)
        VALUES (?, 'AES-256-GCM', ?, ?, 'v1', 12, 16, ?)
      `).run(fileId, encryption.keyVersion, encryption.wrappedDek, timestamp);
      this.recordEvent(transferId, 'ENCRYPTION_STARTED', { chunkSize });
    });
    execute();
  }

  finalizeEncryption({ transferId, plaintextSize, ciphertextSize, ciphertextSha256, totalChunks }) {
    const execute = this.db.transaction(() => {
      const row = this.db.prepare('SELECT t.state, t.file_id FROM transfers t WHERE t.transfer_id = ?').get(transferId);
      if (!row) throw new Error('Transfer was not found.');
      assertTransition(row.state, 'ENCRYPTED');
      const timestamp = now();
      this.db.prepare(`
        UPDATE files SET plaintext_size = ?, ciphertext_size = ?, ciphertext_sha256 = ?, updated_at = ? WHERE file_id = ?
      `).run(plaintextSize, ciphertextSize, ciphertextSha256, timestamp, row.file_id);
      this.db.prepare(`
        UPDATE transfers SET state = 'ENCRYPTED', total_chunks = ?, updated_at = ? WHERE transfer_id = ?
      `).run(totalChunks, timestamp, transferId);
      this.recordEvent(transferId, 'ENCRYPTION_COMPLETED', { totalChunks, ciphertextSize });
    });
    execute();
  }

  getTransfer(transferId) {
    return this.db.prepare(`
      SELECT t.*, f.original_filename, f.content_type, f.plaintext_size, f.ciphertext_size, f.ciphertext_sha256, f.storage_key,
        e.algorithm, e.key_version, e.wrapped_dek, e.aad_version, e.iv_bytes, e.tag_bytes
      FROM transfers t
      JOIN files f ON f.file_id = t.file_id
      JOIN encryption_metadata e ON e.file_id = f.file_id
      WHERE t.transfer_id = ?
    `).get(transferId) || null;
  }

  getTransferManifest(transferId, includeWrappedDek = false) {
    const row = this.getTransfer(transferId);
    if (!row) return null;
    const manifest = {
      transferId: row.transfer_id,
      fileId: row.file_id,
      originalFilename: row.original_filename,
      contentType: row.content_type,
      plaintextSize: row.plaintext_size,
      ciphertextSize: row.ciphertext_size,
      totalChunks: row.total_chunks,
      chunkSize: row.chunk_size,
      ciphertextSha256: row.ciphertext_sha256,
      encryption: {
        algorithm: row.algorithm,
        keyVersion: row.key_version,
        aadVersion: row.aad_version,
        chunkIvBytes: row.iv_bytes,
        authTagBytes: row.tag_bytes
      }
    };
    if (includeWrappedDek && row.wrapped_dek) manifest.encryption.wrappedDek = row.wrapped_dek;
    return manifest;
  }

  transition(transferId, targetState, details = {}) {
    const execute = this.db.transaction(() => {
      const row = this.db.prepare('SELECT state FROM transfers WHERE transfer_id = ?').get(transferId);
      if (!row) throw new Error('Transfer was not found.');
      assertTransition(row.state, targetState);
      const timestamp = now();
      this.db.prepare(`
        UPDATE transfers
        SET state = ?, updated_at = ?, completed_at = CASE WHEN ? = 'STORED' THEN ? ELSE completed_at END,
          last_error_code = CASE WHEN ? = 'FAILED' THEN ? ELSE NULL END
        WHERE transfer_id = ?
      `).run(targetState, timestamp, targetState, timestamp, targetState, details.errorCode || 'TRANSFER_FAILED', transferId);
      this.recordEvent(transferId, 'STATE_CHANGED', { from: row.state, to: targetState, ...details });
      return targetState;
    });
    return execute();
  }

  prepareForRecovery(transferId, targetState, reason = 'AUTOMATIC_RECOVERY') {
    const execute = this.db.transaction(() => {
      const row = this.db.prepare('SELECT state FROM transfers WHERE transfer_id = ?').get(transferId);
      if (!row) throw new Error('Transfer was not found.');
      if (row.state === targetState) return targetState;
      if (row.state === 'FAILED') {
        assertTransition('FAILED', 'RECOVERY_PENDING');
        this.db.prepare('UPDATE transfers SET state = ?, updated_at = ? WHERE transfer_id = ?').run('RECOVERY_PENDING', now(), transferId);
        this.recordEvent(transferId, 'STATE_CHANGED', { from: 'FAILED', to: 'RECOVERY_PENDING', reason });
      }
      const current = this.db.prepare('SELECT state FROM transfers WHERE transfer_id = ?').get(transferId).state;
      if (current === targetState) return targetState;
      assertTransition(current, targetState);
      this.db.prepare('UPDATE transfers SET state = ?, updated_at = ?, last_error_code = NULL WHERE transfer_id = ?').run(targetState, now(), transferId);
      this.recordEvent(transferId, 'STATE_CHANGED', { from: current, to: targetState, reason });
      return targetState;
    });
    return execute();
  }

  listTransfersByStates(states) {
    if (!Array.isArray(states) || states.length === 0) return [];
    const placeholders = states.map(() => '?').join(',');
    return this.db.prepare(`SELECT transfer_id, file_id, state, updated_at FROM transfers WHERE state IN (${placeholders}) ORDER BY updated_at ASC`).all(...states);
  }

  forceFailure(transferId, errorCode) {
    const execute = this.db.transaction(() => {
      const row = this.db.prepare('SELECT state FROM transfers WHERE transfer_id = ?').get(transferId);
      if (!row || isTerminal(row.state)) return false;
      const timestamp = now();
      this.db.prepare('UPDATE transfers SET state = ?, last_error_code = ?, attempts = attempts + 1, updated_at = ? WHERE transfer_id = ?')
        .run('FAILED', errorCode, timestamp, transferId);
      this.recordEvent(transferId, 'TRANSFER_FAILED', { state: row.state, errorCode });
      return true;
    });
    return execute();
  }

  recordVerifiedChunk({ transferId, chunkIndex, chunkSha256, byteSize, storedPath }) {
    const execute = this.db.transaction(() => {
      const transfer = this.db.prepare('SELECT total_chunks FROM transfers WHERE transfer_id = ?').get(transferId);
      if (!transfer) throw new Error('Transfer was not found.');
      if (chunkIndex < 0 || chunkIndex >= transfer.total_chunks) throw new Error('Chunk index is outside the manifest bounds.');
      const expected = this.nextExpectedChunk(transferId);
      const present = this.db.prepare('SELECT chunk_sha256, verified FROM chunks WHERE transfer_id = ? AND chunk_index = ?').get(transferId, chunkIndex);
      if (present) {
        if (present.verified === 1 && present.chunk_sha256 === chunkSha256) return { duplicate: true, nextExpectedChunk: expected };
        throw new Error('Conflicting duplicate chunk detected.');
      }
      if (chunkIndex !== expected) throw new Error(`Unexpected chunk index; expected ${expected}.`);
      const timestamp = now();
      this.db.prepare(`
        INSERT INTO chunks (transfer_id, chunk_index, chunk_sha256, byte_size, verified, stored_path, received_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(transferId, chunkIndex, chunkSha256, byteSize, storedPath, timestamp);
      this.db.prepare('UPDATE transfers SET received_chunks = received_chunks + 1, updated_at = ? WHERE transfer_id = ?').run(timestamp, transferId);
      this.recordEvent(transferId, 'CHUNK_VERIFIED', { chunkIndex, byteSize });
      return { duplicate: false, nextExpectedChunk: chunkIndex + 1 };
    });
    return execute();
  }

  nextExpectedChunk(transferId) {
    const row = this.db.prepare('SELECT COALESCE(MAX(chunk_index), -1) AS max_index FROM chunks WHERE transfer_id = ? AND verified = 1').get(transferId);
    return row.max_index + 1;
  }

  getVerifiedChunks(transferId) {
    return this.db.prepare('SELECT chunk_index, chunk_sha256, byte_size, stored_path FROM chunks WHERE transfer_id = ? AND verified = 1 ORDER BY chunk_index ASC').all(transferId);
  }

  verifyComplete(transferId) {
    const transfer = this.db.prepare('SELECT total_chunks, received_chunks FROM transfers WHERE transfer_id = ?').get(transferId);
    return Boolean(transfer && transfer.total_chunks === transfer.received_chunks);
  }

  setStorageKey(fileId, storageKey) {
    this.db.prepare('UPDATE files SET storage_key = ?, updated_at = ? WHERE file_id = ?').run(storageKey, now(), fileId);
  }

  acquireLease(transferId, owner, leaseSeconds = 120) {
    const timestamp = now();
    const expiry = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    const result = this.db.prepare(`
      UPDATE transfers SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE transfer_id = ? AND (lease_expires_at IS NULL OR lease_expires_at < ? OR lease_owner = ?)
    `).run(owner, expiry, timestamp, transferId, timestamp, owner);
    return result.changes === 1;
  }

  releaseLease(transferId, owner) {
    this.db.prepare('UPDATE transfers SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE transfer_id = ? AND lease_owner = ?')
      .run(now(), transferId, owner);
  }

  recoverStaleTransfers(cutoffIso) {
    const rows = this.db.prepare(`
      SELECT transfer_id FROM transfers
      WHERE state NOT IN ('STORED', 'EXPIRED') AND updated_at < ?
    `).all(cutoffIso);
    for (const row of rows) {
      const current = this.db.prepare('SELECT state FROM transfers WHERE transfer_id = ?').get(row.transfer_id);
      if (current && current.state !== 'RECOVERY_PENDING' && !isTerminal(current.state)) {
        try { this.transition(row.transfer_id, 'RECOVERY_PENDING', { reason: 'STALE_TRANSFER' }); } catch (_) { this.forceFailure(row.transfer_id, 'RECOVERY_STATE_ERROR'); }
      }
    }
    return rows.length;
  }

  getHealthStats() {
    const active = this.db.prepare("SELECT COUNT(*) AS count FROM transfers WHERE state NOT IN ('STORED','FAILED','EXPIRED')").get().count;
    const failed = this.db.prepare("SELECT COUNT(*) AS count FROM transfers WHERE state = 'FAILED'").get().count;
    return { activeTransfers: active, failedTransfers: failed };
  }

  recordEvent(transferId, eventType, data) {
    this.db.prepare('INSERT INTO events (transfer_id, event_type, event_data_json, created_at) VALUES (?, ?, ?, ?)')
      .run(transferId, eventType, JSON.stringify(data), now());
  }

  close() {
    this.db.close();
  }
}

module.exports = { TransferDatabase };
