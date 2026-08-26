# Central Audit — Explicit Plaintext Isolation Between Nodes

**Scope of review:** `server1-upload/` and `server2-relay/` and `server3-storage/` and `shared/validation.js` and the database layer, plus the end-to-end transfer test.
**Review basis:** Code was not modified during the audit session.
**Verdict:** PASS; no CRITICAL, HIGH, or MEDIUM findings are open within the plaintext isolation scope.

## Practical verification

| Potential path for plaintext or key leakage | Server 2 | Server 3 | Result |
|---|---|---|---|
| body requests | Receives only AES-GCM records | Receives only AES-GCM records | PASS |
| wrapped DEK | remote schema rejects it; DB records it `NULL` | remote schema rejects it; DB records it `NULL` | PASS |
| DEK/Master Key/Vault | Does not import `key-provider` or any decryption | Does not import `key-provider` or any decryption | PASS |
| Filenames | Replaces locally with `opaque-<fileId>` | Replaces locally with `opaque-<fileId>` | PASS |
| Content-type and plaintext size | Not sent in the remote manifest | Not sent in the remote manifest | PASS |
| Filesystem | chunks under UUID/index only | persistent chunks under `files/<fileId>/chunks` | PASS |
| logs/errors | No printing of body, keys, or filename | No printing of body, keys, or filename | PASS |
| metadata and database | No wrapped DEK; metadata filename is a placeholder | No wrapped DEK; metadata filename is a placeholder | PASS |
| Decryption endpoint | Not present | Not present | PASS |

## Test evidence

The full integration test practically confirmed that only Server 1 holds `wrapped_dek`, while both remote nodes store `NULL`. The test also sent a malicious filename `../sensitive.txt` and verified that the Relay stored only `opaque-<fileId>`, and that the ciphertext stored on Server 3 differed from the source. The test succeeded on 26 August 2026.

## Static analysis notes

Static inspection of both `server2-relay/index.js` and `server3-storage/index.js` did not find calls to `unwrapDek` or `decryptChunk` or `createDecipheriv`, nor variables `MASTER_KEY` or `VAULT_*` or `wrappedDek`. The only match for `originalFilename` is the creation of an artificial placeholder from `fileId` after the restricted manifest passes validation.

> **Decision to proceed:** The structural isolation of plaintext is sound. Neither Server 2 nor Server 3 possesses the code capability, credentials, or metadata necessary to decrypt the file. May proceed to Phase 7 for resumption and recovery from failures.
