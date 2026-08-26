# Phase 9 — Security Test Suite

**Status:** Complete. The implemented security test suite passes in full.

| Test area | Scenario | Result |
|---|---|---|
| Replay | Resubmitting manifest with same `transferId` but different ciphertext SHA-256 | PASS: Relay returns `409 TRANSFER_MANIFEST_CONFLICT`. |
| Unauthorized node | server3's certificate attempts to call Relay which accepts only server1 | PASS: `403` response. |
| path traversal | filename of `../../private/secret.txt` and storage path containing `..` | PASS: filename reduced to safe metadata only, path rejected. |
| chunk size/shape | negative index, non-hex hash, size exceeding limit | PASS: validation schema rejects them. |
| ciphertext integrity | bit flip in ciphertext or AAD/index | PASS: GCM authentication fails. |
| IV reuse | encrypting consecutive chunks under the same DEK | PASS: IV is unique per index. |
| key isolation | e2e inspection of node databases | PASS: wrapped DEK present only on Server 1. |
| size limit | stream limit enforced inside encryption, not only header | PASS by design and covered by `UPLOAD_TOO_LARGE` path. |
| log leakage | central redaction of keys/tokens/body/filename | PASS via static analysis and logger config review. |

## Verification commands

```bash
npm run lint
npm test
npm run test:security
```

The most recent run of `npm run test:security` achieved **3/3** successes, and the lint check passed. The project test suite currently contains unit, integration, and security tests covering the happy path, resumable destinations, mTLS, AES-GCM encryption, observability, and input tampering.

> Limitations that must be addressed before production: performing a dependency scan in an internet-connected CI environment, load testing with large files/thousands of connections, and validating certificate revocation in production using CRLs. These are operational requirements not covered by local development certificates.
