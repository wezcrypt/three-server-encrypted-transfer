# Security Policy

## Security posture

This repository is a security-focused reference implementation, but it is **not production-ready** until the open findings and required staging tests in [docs/FINAL_SECURITY_AUDIT.md](docs/FINAL_SECURITY_AUDIT.md) are resolved. The detailed security model, production controls, and operational limits are documented in [docs/SECURITY.md](docs/SECURITY.md).

## Supported versions

Security fixes are evaluated against the latest commit on the `main` branch. No released version line is currently supported.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for a suspected vulnerability. Instead, report it privately to the repository owner through GitHub's private contact options or another mutually agreed private channel.

A useful report includes:

- a concise description of the risk and affected component;
- reproduction steps or a minimal proof of concept, where safe to share;
- expected and actual behavior;
- potential impact and any suggested mitigation; and
- your preferred disclosure timeline and contact method.

Do not include private keys, access tokens, Vault credentials, real ciphertext, customer metadata, personal data, or other secrets in a report.

## Scope

Examples of in-scope security concerns include authenticated-encryption misuse, key exposure, mTLS validation gaps, authorization bypasses, state-machine inconsistencies, unsafe file paths, replay handling, recovery data loss, log redaction failures, and dependency vulnerabilities.

## Disclosure process

The maintainer will acknowledge a private report, assess impact, prepare a fix or mitigation where feasible, and coordinate disclosure timing with the reporter. No response-time SLA is guaranteed for this personal reference project.
