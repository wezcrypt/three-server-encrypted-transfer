# Documentation

[![English](https://img.shields.io/badge/Language-English-2563eb)](README.md)
[![العربية](https://img.shields.io/badge/اللغة-العربية-0f766e)](ar/README.md)

Use this index to navigate the English project documentation. The complete Arabic documentation is available through the language button above.

## Core guides

| Document | Purpose |
|---|---|
| [Architecture](ARCHITECTURE.md) | Trust boundaries, file lifecycle, internal APIs, persistence, and recovery. |
| [Security](SECURITY.md) | Security controls, threat model, incident response, and operational constraints. |
| [Key Management](KEY_MANAGEMENT.md) | Envelope encryption, Vault Transit, key lifecycle, rotation, and development limitations. |
| [Deployment](DEPLOYMENT.md) | Certificate handling, network topology, systemd, firewall rules, and release checklist. |
| [Final Security Audit](FINAL_SECURITY_AUDIT.md) | Security findings, readiness decision, and required pre-production validation. |

## Implementation records

The `PHASE_*.md` documents record the build, review, recovery, mTLS, isolation, and security-test decisions made during implementation. They are retained for technical traceability and should be read alongside the final audit before making security-sensitive changes.

## Language support

| Language | Start page |
|---|---|
| English | [Repository README](../README.md) |
| العربية | [دليل المشروع العربي](../README.AR.md) |
