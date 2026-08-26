# Phase 8 — Monitoring, Logging, Health

**Status:** Complete. Servers use sanitized structured JSON logs and health endpoints that prevent exposure of secrets or file data.

## Structured logs

| Node | Events logged | Explicitly excluded data |
|---|---|---|
| Server 1 | Transfer success, transfer failure, request handler error | `authorization`, tokens, Master Key, Vault Token, wrapped DEK, filename, request body, stack/message. |
| Server 2 | Storage confirmation, Relay→Storage failure, request error | Same list, with no plaintext or key provider present on this node. |
| Server 3 | Storage confirmation, final verification failure, request error | Same list, with no plaintext or key provider present on this node. |

The system logs `transferId` and `fileId` and fixed event codes, which are operational data necessary for tracing and do not contain the username or file contents. All sensitive fields in the logger are passed through a centralized redaction list.

## Health endpoints

| Endpoint | Protection | Fields |
|---|---|---|
| `GET /health` — Server 1 | Bearer token when configured; mandatory in production | uptime, RSS, heap, CPU/load, RAM, disk, active/failed transfers. |
| `GET /health` — Server 2 | mTLS and identity limited to server1 only | Same operational fields, no file metadata. |
| `GET /health` — Server 3 | mTLS and identity limited to server2 only | Same operational fields, no file metadata. |

## Verification

| Test | Result |
|---|---|
| Full linting check | PASS |
| All unit and integration tests | PASS: 12/12 on 26 August 2026. |
| Health snapshot test | PASS; contains transfer indicators and does not contain `wrappedDek` or `filename`. |
| Redaction review | PASS; includes authorization/cookie/body/keys/tokens/filename/error stack. |

> **Decision to proceed:** This phase does not log plaintext content, credentials, or wrapped keys. Proceed to security test suite Phase 9.
