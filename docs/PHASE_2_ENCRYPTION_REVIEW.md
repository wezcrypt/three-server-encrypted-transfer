# Phase 2 — Encryption Layer and Key Management

**Build status:** Complete.
**Independent security review status:** Now moving to the mandatory audit checkpoint for Sections 3 and 4 of the guide.

## Implemented design

| Area | Implementation | Security property |
|---|---|---|
| DEK | 32 random bytes from `crypto.randomBytes` per file | Data encryption key is not reused between files. |
| Content encryption | AES-256-GCM | Confidentiality and integrity are authenticated by the standard library, with no custom algorithm. |
| Chunk frame | `IV(12) || Tag(16) || Ciphertext` | Each transfer record has independent IV and authentication tag. |
| IV | 8-byte random prefix + `chunkIndex` 4 bytes | IV unique per chunk within a single DEK; the imposed maximum for chunks is much smaller than the available space. |
| AAD | file ID, transfer ID, index, plaintext length, and schema version | Prevents swapping chunks or moving them between different files or transfers. |
| DEK wrapping | Vault Transit in production, and a separate local development provider | DEK or Master Key does not move to Server 2/3 or within the file. |
| Key provider failure | Timeouts and rejection on incorrect responses | Unavailable Vault or wrong key prevents encryption or decryption; there is no silent fallback. |

## List of executed tests

| Test | Status | Evidence |
|---|---|---|
| Encrypt then decrypt a record with matching context | PASS | Unit test `AES-256-GCM record decrypts only with matching context`. |
| Change chunk index in AAD | PASS | GCM verification fails. |
| Modify a ciphertext byte | PASS | `decipher.final()` fails and does not yield trusted plaintext. |
| Unique IV per chunk | PASS | Test comparing IV for index 0 and 1. |
| Lint and run all tests | PASS | `npm run lint && npm test` on 26 August 2026. |

## List of required manual tests

| Test | Procedure | Acceptable result |
|---|---|---|
| Rotate Vault key | Encrypt a file with the Transit key then rotate the key and decrypt the old DEK | Decryption succeeds only per Vault policy, with the key version retained in metadata. |
| Vault unavailable | Disable access to `VAULT_ADDR` during wrapping | Request fails and no valid manifest or file transfer is created. |
| Production mode with development provider | Run `RUNTIME_ENV=production` and `KEY_PROVIDER=development` | Process exits before opening the network port. |
| Log leakage | Inspect logs of a failed run | No `MASTER_KEY_B64` or `VAULT_TOKEN` or `wrappedDek` or DEK appears. |
| Deliberate IV reuse | Attempt to pass an index that exceeds the range or an invalid prefix | Explicit rejection, and no repeated IV is used. |

> **Non-negotiable requirement:** `MASTER_KEY_B64` is acceptable only in an isolated development environment. Any production run mandates `KEY_PROVIDER=vault`, and Vault credentials must be present on Server 1 only.

## References

[1] [Node.js Crypto: authenticated encryption](https://nodejs.org/api/crypto.html)
[2] [NIST SP 800-38D: GCM and GMAC](https://csrc.nist.gov/pubs/sp/800/38/d/final)
[3] [HashiCorp Vault Transit](https://developer.hashicorp.com/vault/docs/secrets/transit)
