# Phase 0 — Environment Audit and Setup Plan

**Date:** 26 August 2026
**Status:** Completed; this document and Phase 0 contain no executable code.

## Environment inspection results

| Item | Result | Decision or Impact |
|---|---:|---|
| Node.js | `v22.13.0` | Suitable for running Node.js servers and using built-in `crypto` and `https` modules. |
| npm | `10.9.2` | Suitable for package management and lockfile control. |
| OpenSSL | `3.0.13` | Suitable for generating an internal CA and mTLS certificates for development and testing. |
| GCC | Not available | Local native package builds are not assumed; documented JavaScript packages or a build environment in the packaging step will be used if needed. |
| SQLite CLI | Not available | Does not affect runtime; the database will be managed from the application layer. |
| Disk space | Approximately 32GB available | Sufficient to build the package and run integration tests with limited-size test files. |

## Closed architectural decisions

| Open decision | Resolved decision | Rationale |
|---|---|---|
| Database | SQLite per-node local database in the initial operational release | Keeps state locally durable, simplifies deployment to three separate VPSs, and allows resume after restart. Databases are not a shared source for plaintext data or keys. |
| Key management in development | Environment variable `MASTER_KEY_B64` 32-byte length explicitly labeled **Development only** | Serves local development and testing only without embedding secrets in code. The implementation will fail in production mode if this provider is selected. |
| Key management in production | HashiCorp Vault Transit API with fail-closed | Only Server 1 holds Vault credentials; Server 2 and Server 3 do not have an interface, configuration, or authority to retrieve DEK or Master Key. |
| Encryption | AES-256-GCM with a unique random DEK per file and a unique random IV per chunk | Prevents IV reuse with a DEK and enables streaming encryption and independent verification per chunk. |
| Key wrapping | Vault Transit in production; AES-256-GCM with a locally-held development key in development | Stores only the wrapped DEK and key version; does not include the DEK or Master Key in the file or in requests to Server 2/3. |
| Internal transport | HTTPS/mTLS mutual TLS with an internal CA; `rejectUnauthorized: true` always; application-level verification of CN/SAN and the node role | The handshake alone is not sufficient; the certificate identity must match the expected role. |
| Deployment | Three independent Node.js processes, each on its own VPS/service account and owned storage path | Reduces blast radius and prevents Server 2 or Server 3 from accessing Server 1 files or Vault. |
| Transport and reliability | Default chunk size 8 MiB, SHA-256 per chunk, and SHA-256 for the total ciphertext; state transitions recorded atomically | Enables resuming interrupted transfers and prevents acknowledgement before final verification. |
| Source deletion | No automatic deletion of the plaintext source ever by Server 1; only the temporary ciphertext copy is deleted after `STORED` by Server 3 | More conservative than the golden rule: the source copy remains with its owner, avoiding data loss due to network failure. |
| File retrieval | Deferred as an internally-restricted API until a user identity system is available; first release does not support disclosing plaintext via Server 2/3 | Reduces the attack surface. The forward transfer path remains fully implemented as required. |
| Binding interface | Interactive single CLI, built as an executable Node package, with Linux x64 and Windows x64 outputs | Collects connection fields for the three nodes with certificates and the storage path, validates them, creates a restricted-permission config file, and launches the processes automatically. |

## Planned dependencies

| Package or module | Usage | Reason for choice |
|---|---|---|
| `node:crypto` | AES-256-GCM, SHA-256, secure randomness | Part of Node.js and no custom algorithm is necessary. |
| `node:https` and `node:tls` | mTLS servers and clients | Direct control over `ca`, `cert`, `key`, and `rejectUnauthorized`. |
| `node:stream` | Streaming transfer and encryption | Prevents loading the entire file into memory. |
| `better-sqlite3` | Transfer state and atomic transactions | Durable SQLite with a simple synchronous transaction interface. |
| `zod` | Input and metadata validation | Reduces schema errors and provides consistent validation. |
| `pino` | Structured JSON logging with redaction | Prevents logging bodies or secrets and enables clear production operation. |
| `@yao-pkg/pkg` | CLI bundling for Linux and Windows | Targets standalone executable outputs for the unified application. |

## Trust model and access boundaries

| Node | Allowed | Not allowed |
|---|---|---|
| Server 1 — Upload | plaintext during upload, temporary DEK, Vault credentials, temporary ciphertext | Granting keys to other nodes, logging keys, or placing keys in transferred metadata. |
| Server 2 — Relay | ciphertext, hashes, necessary transfer metadata only | plaintext, DEK, Master Key, Vault credentials. |
| Server 3 — Storage | ciphertext, hashes, limited metadata for storage | plaintext, DEK, Master Key, Vault credentials. |
| Binding application | Certificate paths and node configuration | Does not create or copy any file encryption keys. |

## Manual checklist for the phase

| Test | Result |
|---|---|
| Node.js, npm, OpenSSL, and disk space versions checked. | PASS |
| Database, key provider, deployment locations, and transport protocol documented. | PASS |
| Trust boundaries between the three nodes defined. | PASS |
| No executable code written in Phase 0. | PASS |

> **Follow-up decision:** There are no open architectural questions preventing progress to Phase 1. The environment key provider will remain restricted to development, and the application will prevent using it in production mode.

## References

[1] [Node.js Crypto API](https://nodejs.org/api/crypto.html)
[2] [HashiCorp Vault Transit Secrets Engine](https://developer.hashicorp.com/vault/docs/secrets/transit)
[3] [Node.js TLS API](https://nodejs.org/api/tls.html)
