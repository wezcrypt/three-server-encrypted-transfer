## Summary

Describe the user-facing or operational change in a few clear sentences.

## Security impact

- [ ] This change does not affect a security boundary, cryptography, key management, mTLS, authorization, persistence, recovery, deletion, or logging.
- [ ] This change affects one or more security-sensitive areas and the implications are described below.

Explain the impact, mitigations, and any required operator action:

## Validation

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:security`
- [ ] `npm audit --omit=dev --audit-level=low`
- [ ] Relevant documentation was updated.

List additional tests, manual checks, or why a listed check was not applicable:

## Checklist

- [ ] No private keys, certificates, tokens, Vault credentials, real ciphertext, customer metadata, generated configuration, binaries, or runtime data are included.
- [ ] The change preserves the trust boundaries documented in `docs/ARCHITECTURE.md`.
- [ ] The change does not represent the project as production-ready contrary to `docs/FINAL_SECURITY_AUDIT.md`.
