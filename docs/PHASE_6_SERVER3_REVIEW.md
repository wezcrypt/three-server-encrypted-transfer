# Phase 6 — Server 3 Final Storage

**Status:** Complete. A full integration test was run from Server 1 to Server 2 to Server 3 successfully.

## Implementation

| Area | Implementation | Guard |
|---|---|---|
| Storage acceptance | mTLS with expected identity `server2` only | Server 1 or an external client cannot write directly to Storage. |
| metadata | Tight manifest containing no plaintext metadata or wrapped DEK | Storage lacks the information required to decrypt or determine the username. |
| Storage location | `files/<fileId>/chunks/<index>.chunk` | No filename is used; the path is derived from a verified UUID. |
| Verification | SHA-256 per chunk, sequential ordering, then SHA-256 of the assembled ciphertext | Not marked `STORED` before full verification. |
| Confirmation | Updates its database to `STORED` and returns the `storageKey` only after verification | Relay does not delete its copy before final confirmation. |
| Retry behavior | Repeated identical manifest or chunk is idempotent; conflicting ones are rejected | Retries do not corrupt or swap the file. |

## Executed integration test

Ran the test `end-to-end transfer stores only ciphertext on Server 2 and Server 3` on 26 August 2026. Used a random file of size 2.5 MB and sent the raw body to `POST /upload` on Server 1, then verified the following items:

| Verification | Result |
|---|---|
| Server 1 response | `201` and `status=STORED`. |
| Database states | Server 1, Server 2, and Server 3 all `STORED`. |
| wrapped DEK | Present only on Server 1; `NULL` on Server 2 and Server 3. |
| Final storage | storage key matches `files/<fileId>` only. |
| Final content | ciphertext differs from the random source; no plaintext stored. |
| Relay copy | Relay temporary folder was deleted after Storage confirmation. |
| Submitted filename | `../sensitive.txt` did not appear in the Relay; the Relay logged only `opaque-<fileId>`. |

After fixing SQLite Relay log initialization to be created before the first query, all four integration tests passed.

> **Follow-up decision:** The structural boundary for plaintext data is now complete: Server 1 is the only node that handles plaintext and DEK. An independent review to isolate plaintext begins per Section 2 of the guide.
