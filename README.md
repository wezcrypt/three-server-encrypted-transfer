# Three-Server Encrypted Transfer

[![English](https://img.shields.io/badge/Language-English-2563eb)](README.md)
[![العربية](https://img.shields.io/badge/اللغة-العربية-0f766e)](README.AR.md)

[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Security model](https://img.shields.io/badge/Security-Envelope%20Encryption-0f766e)](docs/SECURITY.md)
[![Transport](https://img.shields.io/badge/Transport-mTLS-2563eb)](docs/ARCHITECTURE.md)
[![Status](https://img.shields.io/badge/Status-Reference%20Implementation-f59e0b)](docs/FINAL_SECURITY_AUDIT.md)

A security-focused reference implementation for resilient file transfer across three isolated services. Use the language buttons above to switch between the complete English and Arabic project guides.

```text
Client  ── HTTPS + Bearer ──>  Server 1: Upload  ── mTLS ──>  Server 2: Relay  ── mTLS ──>  Server 3: Storage
                                      │                                           │                           │
                               plaintext + DEK                             ciphertext only             ciphertext only
                               Vault Transit access                         no key access                no key access
```

The system encrypts a file at the upload boundary, transfers verified ciphertext in chunks, and stores only ciphertext at the final destination. It is designed around explicit trust boundaries, authenticated encryption, mutual TLS, durable transfer state, and conservative crash recovery.

> **Important:** This repository is public for review and development. It is **not production-ready** until the open operational findings and staging tests in the [final security audit](docs/FINAL_SECURITY_AUDIT.md) are completed. Do not deploy development certificates, development keys, or sample configuration values to a production environment.

## Highlights

| Capability | Implementation |
|---|---|
| Per-file encryption | A fresh 256-bit Data Encryption Key (DEK) is generated for every file and used with AES-256-GCM. |
| Envelope encryption | Server 1 wraps DEKs with HashiCorp Vault Transit in production; Server 2 and Server 3 never receive plaintext keys. |
| Secure service transport | Internal service-to-service calls require TLS 1.3, client certificates, CA validation, application-level node identity checks, and a CRL in production. |
| Chunk integrity | Every encrypted chunk is hashed and verified. The complete ciphertext hash is verified again at final storage. |
| Durable recovery | SQLite-backed transfer state, idempotent manifest handling, resumable chunks, leases, and cautious stale-transfer cleanup. |
| Least plaintext exposure | Plaintext exists only as a stream inside Server 1. No plaintext temporary file, decrypt endpoint, or key provider exists in Server 2 or Server 3. |
| Operator tooling | A cross-platform connector CLI collects node settings, writes protected local configuration, and starts a co-located development topology. |

## Repository layout

| Path | Purpose |
|---|---|
| `server1-upload/` | HTTPS upload API, streaming encryption, key wrapping, and transfer recovery. |
| `server2-relay/` | mTLS-only ciphertext relay with manifest and chunk verification. |
| `server3-storage/` | Final ciphertext storage with full-hash verification. |
| `shared/` | Cryptography, validation, SQLite persistence, mTLS, observability, state, and recovery utilities. |
| `connector/` | Cross-platform operator CLI source. |
| `config/` | Development-only certificate generator. |
| `migrations/` | Durable SQLite schema migration. |
| `tests/` | Unit, integration, recovery, mTLS, and security tests. |
| `docs/` | Architecture, deployment, key-management, and security documentation. |

## Quick start

### Run from source

```bash
npm install
npm run certs:dev
npm run lint
npm test
npm run test:security
```

The development certificate generator writes local material under `config/certs/`, which is intentionally ignored by Git. Never reuse those certificates in production.

### Build and run the connector

```bash
npm run build:connector
chmod +x dist/three-server-connector-linux-x64
./dist/three-server-connector-linux-x64
```

On Windows x64:

```powershell
.\dist\three-server-connector-win-x64.exe
```

The interactive connector validates the CA and CRL locations, node addresses, ports, mTLS certificates, private keys, storage paths, upload limits, and runtime profile. It then creates protected node configuration files and starts all three services for a **co-located development deployment**.

## Production deployment

Production must use three independently operated nodes or service accounts, with Server 1 able to reach Server 2 and Server 2 able to reach Server 3. Server 2 and Server 3 must not expose their internal endpoints to the public internet.

| Requirement | Production expectation |
|---|---|
| Key provider | `RUNTIME_ENV=production` and `KEY_PROVIDER=vault` on Server 1 only. |
| Certificate revocation | A current CRL is mandatory for every node configuration. |
| Access control | Use an application-layer upload token or equivalent authenticated edge control for Server 1. |
| Network policy | Permit only Server 1 → Server 2 and Server 2 → Server 3 on internal service ports. |
| Secret handling | Use a secret manager or service-account environment. Never commit private keys, tokens, Vault credentials, or generated configuration. |
| Validation | Complete the operational fixes and all pre-production tests listed in the final security audit. |

For the complete procedure, read [Deployment](docs/DEPLOYMENT.md), [Key Management](docs/KEY_MANAGEMENT.md), and [Security](docs/SECURITY.md).

## Verification

```bash
npm run lint
npm test
npm run test:security
npm audit --omit=dev --audit-level=low
```

The documented final local verification recorded 15 project tests passing, 3 dedicated security tests passing, and no audited production dependency vulnerabilities. Re-run the commands in your own environment before every release.

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Trust boundaries, data flow, APIs, storage layout, and recovery model. |
| [Security](docs/SECURITY.md) | Security controls, threat model, incident response, and non-negotiable production settings. |
| [Key Management](docs/KEY_MANAGEMENT.md) | DEK lifecycle, Vault Transit configuration, key rotation, and development-mode limitations. |
| [Deployment](docs/DEPLOYMENT.md) | VPS topology, certificate handling, systemd guidance, firewall rules, and production checklist. |
| [Final Security Audit](docs/FINAL_SECURITY_AUDIT.md) | Findings, readiness decision, required fixes, and pre-production test plan. |
| [Phase Reviews](docs/) | Build and review records for each implementation phase. |

## Community and contribution

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request, and follow the expectations in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security-sensitive reports must follow [SECURITY.md](SECURITY.md) rather than public issue disclosure. The repository includes structured issue and pull-request templates to keep public discussion useful and to avoid accidental disclosure of sensitive material.

## License

No open-source license has been selected yet. All rights are reserved unless and until the repository owner adds a license file.
