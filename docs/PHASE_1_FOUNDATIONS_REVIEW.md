# Phase 1 — Review of Common Foundations

**Status:** Completed after independent review of state constants, input schemas, and database migrations.

## What was implemented

| Component | Implementation | Security control |
|---|---|---|
| State machine | Explicit states from `CREATED` through `STORED`, plus `FAILED`, `RECOVERY_PENDING`, and `EXPIRED` | Central function that rejects any undefined transition, including `FAILED → STORED` and `STORED → ENCRYPTING`. |
| Validation | `zod` schemas for the manifest, the chunk, and the node identity | UUIDs, size limits, correct hex hashes, and restricted filenames; usernames are not converted into paths. |
| Database | SQLite/WAL with relations, indexes, and transactions | Critical changes recorded within transactions, foreign keys enabled, and unique chunk index per transfer. |
| Conflict prevention | Verify the next expected chunk and idempotent handling of identical duplicates | Prevents skipping chunks or replacing a previous chunk with different data. |
| Operational locking | Time-limited lease with a specified owner | Prevents two workers from processing the same transfer concurrently. |

## Self-review

The following were reviewed with a mindset separate from implementation:

| Review item | Result | Note |
|---|---|---|
| Impossible transitions | PASS | The `assertTransition` function is the central enforcement point. |
| Duplicate `transfer_id` or `file_id` | PASS | Unique primary keys and rejection of inserting an existing transfer. |
| SQL injection | PASS | All application values are passed through prepared statements; static SQL only in migrations. |
| path traversal | PASS | Store the name only as metadata, with `sanitizeFilename`; storage paths will later be built from UUID. |
| Key leakage | N/A | Key layer has not yet started; there are no explicit key fields in the schema. |
| Data deletion | PASS | There are no deletion operations for the source at this stage. |

## Manual test list

| Test | Procedure | Expected result |
|---|---|---|
| Failed → Stored transition | Attempt `FAILED → STORED` | Explicit rejection and no row modification. |
| Out-of-order chunk | Send index 2 before 0 | Explicit rejection with counter remaining zero. |
| Identical duplicate chunk | Re-send a verified chunk with the same hash | Idempotent response without incrementing the counter. |
| Conflicting duplicate chunk | Re-send the same index with a different hash | Explicit rejection. |
| Malicious path name | `../../secrets.txt` as filename | Saved only as safe metadata name and does not determine a path. |
| Reopen the database | Terminate the process then reopen SQLite itself | Transfer states and chunks remain present. |

> **Decision to proceed:** The common foundations pass Phase 1 review. Phase 2 will begin by creating a random DEK and streaming AES-GCM encryption, without transferring the DEK to any remote node.
