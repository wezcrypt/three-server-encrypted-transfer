# Data Loss Audit — Phase 7

**Scope of the review:** state transitions, all deletion operations, worker recovery, and flows from Server 1 to Server 3.
**Audit baseline:** No code changes were made during the session.
**Verdict:** PASS; there are no CRITICAL, HIGH, or MEDIUM findings open in the data-loss path.

## Actual reviewed sequence

> `Source → Encryption → ciphertext verification → Relay verification → Storage verification → STORED confirmation → temporary ciphertext deletion`

Server 1's application does not have a delete command for the source plaintext to begin with, because the file arrives as a stream from the client and the application does not create a local plaintext copy. Therefore a network failure or worker cannot delete the source. The temporary ciphertext on Server 1 is not deleted until it receives an explicit Relay response `200` and `status=STORED`, after the `STORED` state has been recorded locally.

| Deletion operation | Precondition | Does it represent a recoverable data source? | Result |
|---|---|---|---|
| Deletion of `.part` on encryption failure | File not yet acknowledged and final ciphertext file does not exist | No; only an untrusted partial file | PASS |
| Deletion of ciphertext on Server 1 | `status=STORED` from Relay and local state transitioned to STORED | Final storage verified the full hash | PASS |
| Deletion of Relay chunks | `status=STORED` from Server 3 after full hash | Server 3 has durable storage | PASS |
| Deletion of old `.part` | 6-hour configurable timeout | Matches only partial files; does not touch `.bin` or verified chunks | PASS |
| Deletion of Storage chunks | No delete path in the application | Final storage is durable | PASS |

## Failure scenarios

| Scenario | Reference copy after failure | Recovery | Risk of incorrect deletion |
|---|---|---|---|
| Interruption at 10% | Source at client; Server 1 `.part` or draft | Re-upload; `.part` only cleaned after timeout | None |
| Interruption at 50% | Final ciphertext on Server 1 and chunks verified on Relay if present | Server 1 resumes from `nextChunk` | None |
| Interruption at 90% | ciphertext on Server 1 + Relay verified chunks | Idempotent chunk retry then full hash | None |
| Storage unavailable | Server 1 ciphertext and Relay chunks | Integrity test proves successful resume when Storage is back | None |
| Server 1 crashes after Storage confirmation | ciphertext may remain as extra (not lost) | Idempotent retry reaches STORED then deletes ciphertext | None |
| Server 2 crashes after Storage confirmation | Durable Storage exists; Relay chunks may remain as extra | Retry reconfirms Storage then cleans Relay | None |
| Server 3 crashes before complete | Final chunks are present but no STORED | Relay retransmits manifest/chunks then complete | None |
| Hash failure | Documented source/ciphertext copy remains; the corrupted chunk is not recorded | Retransmit from last verified | None |
| Worker crash | No wholesale deletion occurs; there is no delete operation for verified data | Periodic worker starts on boot | None |
| Machine reboot | SQLite WAL + persistent files preserve state | Start-up resume and leases | None |

## Concurrency and atomicity review

The DB records chunks in a transaction after hashing, writing, and `fsync`, and uses a unique key `(transfer_id, chunk_index)`. A lease protects the Relay→Storage stage from competing workers. Forbidden transitions like `FAILED → STORED` are rejected by the state machine. Idempotent behavior for identical manifest/chunk prevents retries from doubling counters or replacing data.

> **Review decision:** The sequence satisfies the golden rule: no deletion of a valid copy before destination confirmation. Proceed to Phase 8.
