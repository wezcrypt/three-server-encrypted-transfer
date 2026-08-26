# Security Policy

## Mandatory Controls

| Domain | Control |
|---|---|
| Encryption | AES-256-GCM from `node:crypto` only, with a unique random DEK per file. |
| IV and AAD | 8-byte random IV + chunk index, and AAD binds file ID, transfer ID, index, and length. |
| Keys | Vault Transit mandatory in production; `MASTER_KEY_B64` is for development only and rejected in production. |
| mTLS | TLS 1.3, trusted CA, client certificate required, `rejectUnauthorized=true`, application-level CN/SAN verification. |
| Revocation | `MTLS_CRL_PATH`/`tls.crlPath` required in production for every node. |
| Identity | Server 2 accepts only server1, and Server 3 accepts only server2. |
| Plaintext | Server 1 only; no key provider and no decrypt API on Server 2/3. |
| Files | Only UUID/index in paths, `wx` for temporary files, links with no overwrite, restrictive permissions. |
| Limits | upload/chunk/timeout/rate limits; streamed body must not hold the entire file in memory. |
| State | state machine, transactions, leases, and idempotency. |
| Logging | sanitized JSON; do not log body, authorization, cookie, token, keys, wrapped DEK, filename, or stack trace. |

## Threat Model

| Attacker | Capability | What they cannot obtain | Controls |
|---|---|---|---|
| A — Public Internet | Sends uploads or malformed requests to Server 1 | internal endpoints, DEK/Vault, Server 3 storage | HTTPS, production Bearer, rate/size limits, schema validation. |
| B — Compromise of Server 2 | Reads or modifies temporary ciphertext | plaintext or DEK or Vault credentials | envelope encryption, minimized manifest, absence of key provider, hash/AAD/GCM. |
| C — Compromise of Server 3 | Reads stored ciphertext | plaintext or DEK or Vault credentials | same isolation, a path that lacks decryption. |
| D — Compromise of Server 1 | May access in-transit plaintext and Vault data depending on service account | Server 2/3 boundaries do not prevent its impact on plaintext | least-privileged service account, Vault policy, hardening/monitoring, VPS isolation. |
| E — Stolen node certificate | Attempts to impersonate a node until revoked | another node if CN/SAN mismatch or certificate is revoked | mTLS, identity check, CRL in production, rapid renewal. |
| F — Stolen Vault token | Attempts to unwrap DEK via Transit | stored plaintext without ciphertext, and other nodes' data | tight Vault policy, short-lived token, audit logs, rotation/revocation. |

## Settings Not to Disable

Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized:false`. Do not place private keys, Vault tokens, or Master Keys in source code, CLI arguments, or versioned config files. Do not use a development provider in production. Do not expose Server 2 or Server 3 ports to the public Internet except via a network policy that allows only the previous node addresses.

## Incident Response

If a certificate leak is suspected, revoke it in the CA, publish a new CRL, restart nodes to pick up the CRL, and issue a replacement certificate. If a Vault token leak is suspected, revoke it immediately and rotate the Transit key if needed. If Server 2 or Server 3 is compromised, assume exposed ciphertext and metadata are at risk, but do not assume plaintext is exposed without separate evidence of access to Server 1 or Vault.

## Release Limitations

This release does not include an API to retrieve plaintext for users, because that requires an identity/ownership layer and key consent not included in this delivery. This deliberately limits the attack surface. Do not deploy to production before testing the actual CRL, Vault policy, and resilience in your environment.
