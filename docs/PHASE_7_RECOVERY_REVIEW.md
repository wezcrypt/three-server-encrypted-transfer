# Phase 7 — Resume and Failure Recovery

**Status:** Completed. Automatic resume operations and a configurable garbage-collecting reconciler were added; an integration test for destination interruption proved delete-order safety.

## Resume logic

| State | Behavior on restart or retry | Data disposition |
|---|---|---|
| `ENCRYPTING` | draft always remains; after timeout becomes `FAILED`, and only the old `.part` is deleted | No temp plaintext; confirmed data is not deleted. |
| `ENCRYPTED` or `RELAY_RECEIVING` | Server 1 sends the matching manifest and resumes from the `nextChunk` confirmed by Relay | local ciphertext remains until `STORED`. |
| `FAILED` | atomic transition `FAILED → RECOVERY_PENDING → target stage` | Not promoted directly to STORED. |
| Relay/Storage stale | they transition to `RECOVERY_PENDING` and retain verified chunks | Server 1 reactivates the transfer from the matching manifest. |
| old `.part` | a periodic worker deletes it after `staleTransferHours` (default 6 hours) | does not delete a completed `.bin` on Server 1, verified chunks, or confirmed Storage. |
| `STORED` | terminal/idempotent | not modified or deleted by the cleaner. |

## Executed destination-failure test

The test `Server 1 resumes a failed transfer after Storage returns without deleting ciphertext early` was executed in the following sequence:

| Step | Result |
|---|---|
| Start Server 1 and Server 2 with Storage unavailable | upload returns `502` and Server 1 state becomes `FAILED`. |
| Inspect Server 1 | the final ciphertext file `.bin` still exists. |
| Start Server 3 later | no manual intervention in chunks or metadata is required. |
| Invoke the resume worker | returns the manifest, skips chunks confirmed by the Relay, and completes to Server 3. |
| Final check | Server 1, 2, and 3 are all `STORED`. |
| Deletion check | local ciphertext is deleted only after `STORED` confirmation; no source plaintext was deleted. |

All five integration tests passed after adding the recovery scenario.

## Remaining manual tests before production

| Scenario | Expected behavior |
|---|---|
| Disconnect at 10%, 50%, and 90% | same `transfer_id` resumes from the last recorded index. |
| Kill Server 1 process during encryption | only the `.part` remains; after timeout it is cleaned without deleting the user's source. |
| Kill Server 2 during a chunk | a chunk is not recorded as verified until hash and `fsync`; it can be retransmitted safely. |
| Kill Server 3 after the last chunk and before complete | permanent chunks are present, but no `STORED` until full hash on retry. |
| SQLite failure | transfer request fails explicitly and does not acknowledge an unpersisted success. |

> Decision to proceed: No path appears that leads to deletion of a copy before destination confirmation. A full Data Loss audit session as specified in Section 8 of the guide now begins.
