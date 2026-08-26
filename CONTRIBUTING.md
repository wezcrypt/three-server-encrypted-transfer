# Contributing

Thank you for considering a contribution to Three-Server Encrypted Transfer. This repository handles security-sensitive transfer logic, so every change must preserve the trust boundaries described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the controls described in [docs/SECURITY.md](docs/SECURITY.md).

## Before you start

1. Read the [final security audit](docs/FINAL_SECURITY_AUDIT.md) and avoid representing the current code as production-ready.
2. Never include private keys, certificates, tokens, Vault credentials, generated node configuration, runtime databases, encrypted customer data, or binaries in a pull request.
3. Open an issue before starting a large architectural change so maintainers can evaluate the security boundary impact.
4. Keep changes focused and document any change to message formats, transfer state, cryptographic metadata, TLS handling, storage paths, or recovery semantics.

## Development workflow

```bash
npm install
npm run certs:dev
npm run lint
npm test
npm run test:security
```

Use the development certificate generator only for local tests. Do not use it as a production PKI.

## Pull request expectations

A pull request should include a concise explanation of the problem, implementation, risk assessment, and tests performed. Add or update tests for behavioral changes. Changes affecting encryption, key management, mTLS, input validation, persistence, recovery, or deletion must include an explicit security note in the pull request description.

All changes must pass the following checks before review:

```bash
npm run lint
npm test
npm run test:security
npm audit --omit=dev --audit-level=low
```

## Commit style

Use short, imperative commit subjects. Conventional prefixes are preferred:

```text
feat: add verified relay retry
fix: reject inconsistent transfer manifest
docs: clarify Vault Transit deployment
security: harden certificate identity validation
```

## Reporting security issues

Do not publish suspected vulnerabilities, secrets, or exploit details in public issues. Follow the private reporting guidance in [SECURITY.md](SECURITY.md).
