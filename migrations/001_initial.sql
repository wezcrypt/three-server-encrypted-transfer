PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  file_id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  plaintext_size INTEGER NOT NULL CHECK (plaintext_size >= 0),
  ciphertext_size INTEGER NOT NULL CHECK (ciphertext_size > 0),
  ciphertext_sha256 TEXT NOT NULL CHECK (length(ciphertext_sha256) = 64),
  storage_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  transfer_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(file_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('CREATED','ENCRYPTING','ENCRYPTED','RELAY_RECEIVING','RELAY_VERIFIED','STORAGE_RECEIVING','STORED','FAILED','RECOVERY_PENDING','EXPIRED')),
  source_node TEXT NOT NULL,
  destination_node TEXT NOT NULL,
  chunk_size INTEGER NOT NULL CHECK (chunk_size >= 1048576 AND chunk_size <= 16777216),
  total_chunks INTEGER NOT NULL CHECK (total_chunks > 0),
  received_chunks INTEGER NOT NULL DEFAULT 0 CHECK (received_chunks >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  retry_after TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  transfer_id TEXT NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_sha256 TEXT NOT NULL CHECK (length(chunk_sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  stored_path TEXT,
  received_at TEXT,
  PRIMARY KEY (transfer_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('server1','server2','server3')),
  certificate_identity TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encryption_metadata (
  file_id TEXT PRIMARY KEY REFERENCES files(file_id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  key_version TEXT NOT NULL,
  wrapped_dek TEXT,
  aad_version TEXT NOT NULL CHECK (aad_version = 'v1'),
  iv_bytes INTEGER NOT NULL CHECK (iv_bytes = 12),
  tag_bytes INTEGER NOT NULL CHECK (tag_bytes = 16),
  created_at TEXT NOT NULL,
  CHECK (wrapped_dek IS NULL OR length(wrapped_dek) <= 32768)
);

CREATE TABLE IF NOT EXISTS events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id TEXT REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_file_id ON transfers(file_id);
CREATE INDEX IF NOT EXISTS idx_transfers_state_updated ON transfers(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_chunks_transfer_verified ON chunks(transfer_id, verified);
CREATE INDEX IF NOT EXISTS idx_events_transfer_created ON events(transfer_id, created_at);
