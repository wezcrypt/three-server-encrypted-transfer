# Phase 4 — Server 1 Upload + Encryption

**Status:** Complete at the upload server level. Full transfer testing will be performed after Server 2 and Server 3 are completed in Phase 6.

## Execution path

| Step | Implementation | Security or Reliability Guarantee |
|---|---|---|
| 1 | `POST /upload` accepts a streaming body over HTTPS | The body is not read fully into memory. |
| 2 | Enforce `Content-Length` and internal encryption limit `maxPlaintextBytes` | Rejects a file larger than the quota even if Content-Length is missing or forged. |
| 3 | Generates random `fileId` and `transferId` and a new DEK | Storage paths do not use predictable usernames or IDs. |
| 4 | Always creates an `ENCRYPTING` queue entry then encrypts to local ciphertext only | Crashes during encryption are detectable and recoverable; no plaintext temp file is created. |
| 5 | Stores the wrapped DEK in Server 1's database only | It is not included in the remote manifest nor in the Relay request body. |
| 6 | Sends a minimized manifest then ciphertext chunks to Server 2 over mTLS | Server 2 does not receive the filename, content type, plaintext size, or wrapped DEK. |
| 7 | Deletes the temporary ciphertext only upon explicit `STORED` from the Relay | There is no deletion of the source plaintext; this is even more conservative than the golden "no delete before confirmation" rule. |

## Server 1 Interfaces

| Endpoint | Authentication | Behavior |
|---|---|---|
| `POST /upload` | Bearer token in production; optional locally for development | Encrypts the file and continues the transfer or returns a failed/pending status without deleting the source. |
| `GET /transfers/:transferId` | Bearer token in production | Returns only the ID and status; does not return sensitive metadata or keys. |

## Self-review

| Item | Result |
|---|---|
| Streaming encryption without plaintext temp files | PASS |
| Stream-level size limit, not header-only | PASS |
| DEK encrypted and memory buffer wiped after use | PASS |
| Do not send wrapped DEK or filename to Relay | PASS |
| Internal endpoint uses HTTPS/mTLS exclusively | PASS |
| Ciphertext deletion conditioned on explicit `STORED` only | PASS |
| Source plaintext deletion | Not present in the application; PASS |
| Lint and current tests | PASS: `npm run lint && npm test` (9/9) |

## Manual follow-up tests

| Test | Expected result |
|---|---|
| Upload 1 byte under the limit | `201 STORED` after Relay and Storage are running. |
| Upload over the limit without Content-Length | `413 UPLOAD_TOO_LARGE` and only partial ciphertext deleted. |
| Relay unavailable | `502` and local status `FAILED`; no deletion of the source nor of the resumable full ciphertext. |
| Missing token in production | `401 UNAUTHORIZED` before reading the body. |
| Path-traversal filename | Never used in storage path; stored only in Server 1 DB in sanitized form. |

> **Operational note:** Because the plaintext comes directly from the client and the application does not retain a source copy, the "no delete before confirmation" rule holds structurally: Server 1 does not delete the plaintext in the first place.
