# Phase 5 — Server 2 Relay

**Status:** Complete. Server 2 accepts ciphertext only and verifies its integrity locally before forwarding to Server 3.

## Controls implemented

| Domain | Implementation | Security outcome |
|---|---|---|
| Connection acceptance | mTLS + expected certificate identity `server1` | Neither a public client nor server3 can invoke Relay endpoints. |
| manifest | narrow remote schema that doesn't accept filename or content type or plaintext size or wrapped DEK | Explicit metadata does not reach the Relay. |
| replay | duplicate manifest succeeds only if it is byte-for-byte identical for the critical data; otherwise `409` | transfer ID cannot be reused to swap file or hash. |
| chunk | SHA-256 hash, size, and a sequential expected counter | Cannot skip, replace, or confirm a missing chunk. |
| staging | `fileId/transferId/chunkIndex` only, with `wx` open followed by link without overwrite | User names do not influence filesystem paths; file writes are safe against simple overwrite. |
| final verification | SHA-256 of the assembled ciphertext before Storage | A corrupted file does not reach final storage. |
| transfer to destination | mTLS with identity verification `server3` | Relay cannot send ciphertext to an untrusted node. |
| deletion | Relay does not delete chunks until `STORED` from Server 3 | No deletion before final destination confirmation. |

## Self-review

| Question | Result |
|---|---|
| Does Server 2 see plaintext? | No; request bodies are AES-GCM records only, and there is no decryption, key provider, or wrapped DEK. |
| Does Server 2 see the DEK or Master Key? | No; its files and configuration do not import `key-provider`. |
| Can any mTLS client call the relay? | No; CN/SAN matching `server1` is required. |
| Can a conflicting manifest be replayed? | No; `TRANSFER_MANIFEST_CONFLICT` is returned. |
| Does Relay erase its data before Storage confirmation? | No; deletion occurs only after `status=STORED`. |
| Are user names stored as paths? | No; Relay uses `opaque-<fileId>` locally and only constructs paths from UUID/index. |

## Integration tests to follow

| Test | Expected result |
|---|---|
| Send manifest from certificate server3 | `403 MTLS_IDENTITY_MISMATCH`. |
| Send mismatched hash | `422 CHUNK_HASH_MISMATCH` and the chunk is not recorded as verified. |
| Send index 2 before index 0 | `409 CHUNK_REJECTED`. |
| Send the same manifest twice | 201 then 200 with the correct next chunk. |
| Send same manifest with different ciphertext hash | `409 TRANSFER_MANIFEST_CONFLICT`. |
| Storage stalled at complete | Relay retains the chunks and marks the transfer FAILED/resumable, and does not delete them. |
