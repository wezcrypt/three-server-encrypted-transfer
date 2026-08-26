# Three-Server Encrypted Transfer System Architecture

## Overview

The system transfers files across three nodes separated by explicit trust boundaries. Server 1 is the only party that handles plaintext or interacts with a key provider. Server 2 and Server 3 receive only AES-256-GCM encrypted records and minimal metadata required for verification and resumption.

```text
Client -- HTTPS + Bearer --> Server 1 -- mTLS --> Server 2 -- mTLS --> Server 3
                                |                 |                 |
                           plaintext+DEK      ciphertext only    ciphertext only
                           Vault access       no key provider    no key provider
```

## Trust Boundaries

| Node | Inputs | Allowed Access | Prohibited Data |
|---|---|---|---|
| Server 1 Upload | upload stream from the client, and Vault configuration | temporary plaintext in memory, DEK, Vault Transit, temporary ciphertext | Passing the DEK or wrapped DEK or filename to remote nodes. |
| Server 2 Relay | mTLS from Server 1 only | ciphertext chunks, hashes, transfer/file UUIDs | plaintext, DEK, Master Key, Vault token, explicit file name, type, and size. |
| Server 3 Storage | mTLS from Server 2 only | ciphertext chunks, hashes, storage key derived from file ID | plaintext, DEK, Master Key, Vault token, explicit file name, type, and size. |

## Transfer Sequence

| Stage | Action | Transfer State |
|---|---|---|
| 1 | Server 1 allocates `transferId` and `fileId` and a unique DEK, then records `ENCRYPTING`. | `ENCRYPTING` |
| 2 | Segments the stream into AES-GCM records; unique IV per record and AAD binding file/transfer/index/length. | `ENCRYPTED` |
| 3 | Sends a compact manifest to the Relay over mTLS; it does not carry the DEK or plaintext metadata. | `RELAY_RECEIVING` |
| 4 | Relay verifies SHA-256 per chunk and then the full hash of the ciphertext. | `RELAY_VERIFIED` |
| 5 | Relay transfers chunks to Storage over mTLS-authenticated connection; Storage verifies them and then computes the full hash. | `STORAGE_RECEIVING` |
| 6 | Storage records `STORED` and responds with `storageKey=files/<fileId>`. | `STORED` |
| 7 | Relay deletes temporary ciphertext after the response; Server 1 deletes temporary ciphertext only after `STORED`. | `STORED` |

## Storage and State

Each node owns an independent SQLite with WAL and foreign keys enabled. Tables are `files`, `transfers`, `chunks`, `nodes`, `encryption_metadata`, and `events`. transfer state transitions and chunk writes are recorded within atomic transactions. A lease is used in Relay during the send-to-Storage stage to prevent two workers from executing the same transfer concurrently.

Server 3 stores files at `files/<fileId>/chunks/<chunkIndex>.chunk` and never uses the filename provided by the client as part of the path. Server 2 stores only a local placeholder name: `opaque-<fileId>`.

## Network Interfaces

| Node | Endpoint | Authorized Party |
|---|---|---|
| Server 1 | `POST /upload` | Client carrying a Bearer token in production. |
| Server 1 | `GET /transfers/:transferId` and `GET /health` | Bearer token in production. |
| Server 2 | `/internal/transfers*` and `/health` | mTLS certificate presenting server1 identity only. |
| Server 3 | `/internal/transfers*` and `/health` | mTLS certificate presenting server2 identity only. |

## Resumption

Each server maintains a counter of verified chunks. Server 1 re-sends an identical manifest and then resumes from the `nextChunk` confirmed by the Relay. Identical manifests or chunks are idempotent; conflicting duplicates are rejected. A maintenance worker runs every minute to move stale transfers into recovery and deletes only unconfirmed `.part` files after a configurable timeout; it never deletes completed ciphertext, verified chunks, or final Storage.
