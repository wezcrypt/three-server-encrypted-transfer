# Central Audit — Cryptography and Key Management

**Scope of review:** `shared/crypto.js` and `shared/key-provider.js` and `shared/validation.js` and metadata storage locations in `shared/database.js`.
**Review basis:** No code was modified during this review.
**Interim result:** No CRITICAL or HIGH findings; one MEDIUM finding must be fixed before the build continues.

## Summary of Findings

| Area | Result | Notes |
|---|---|---|
| AES-256-GCM | PASS | Uses Node.js `createCipheriv` and `createDecipheriv` with `authTagLength=16`. |
| DEK randomness | PASS | DEK is generated as 32 bytes from a cryptographic random source. |
| IV/nonce | PASS | Unique random prefix per file/DEK combined with chunk index; rejects index outside 32-bit range. |
| AAD | PASS | Binds ciphertext to file ID and transfer ID and chunk index and plaintext length. |
| authentication tags | PASS | Decryption does not succeed prior to `decipher.final()` after setting the tag and AAD. |
| Key separation from remote nodes | PASS by design | The `wrappedDek` field is not included in `remoteTransferManifestSchema`, and remote storage will use `includeWrappedDek=false`. |
| Vault | PASS by design | Production explicitly rejects any provider other than Vault. |
| Developer key rotation | MEDIUM | The development provider ties unwrap exclusively to the current version and lacks a map of older-version keys. |

## Critical and High Findings

There are no Critical or High findings within the current review scope.

## Medium Findings

1. **[MEDIUM] Development provider does not allow reading wrapped files using a previous Development Key version.**

   | Item | Analysis |
   |---|---|
   | Location | `shared/key-provider.js`, function `DevelopmentKeyProvider.unwrapDek`. |
   | Problem | The `wrappedDek` value is rejected unless it matches the current `DEV_KMS_KEY_VERSION`. After rotating the development key, reading files from the previous version fails even if that key remains intentionally available. |
   | Impact | May prevent recovery or retrieval testing of older development files, and weakens key-versioning verification in tests. Does not affect the production pattern that uses Vault Transit with a version embedded in ciphertext. |
   | Exploit scenario | Not a data disclosure path; it's a loss of readability for contexts when changing development settings without retaining the old key. |
   | Fix required | Accept an explicit development keys map `DEV_KMS_KEYS_JSON` in the form version→base64, use the version embedded in the wrapped DEK, and disallow this in production. |

## Passive leak verification

Static search detected the names `MASTER_KEY_B64`, `VAULT_TOKEN`, and `wrappedDek` only in the project's admin code, and did not find any `console.log` or logger calls printing these values, nor any disabling of mTLS. There is not yet an operational logging layer; it will be examined in Phase 8.

## Remediation decision

> The medium finding will be addressed now before moving to Phase 3. There is no CRITICAL or HIGH vulnerability blocking progress, but implementing the fix is required to close the key versioning promise described in the guide.

## References

[1] [NIST SP 800-38D: GCM/GMAC](https://csrc.nist.gov/pubs/sp/800/38/d/final)
[2] [Vault Transit: key rotation and ciphertext versions](https://developer.hashicorp.com/vault/docs/secrets/transit)

## Closing the finding after review

After documenting the finding, only the development provider was modified to accept `DEV_KMS_KEYS_JSON`, which is a version→base64 key map, and selects the key according to the wrapped version. This does not change the prohibition of the development provider in production. Added test `development provider unwraps an older configured key version`, and the full unit test suite is now **PASS (6/6)**.

| Finding ID | Status after fix | Verification |
|---|---|---|
| MEDIUM-1 | CLOSED | Ran `npm run lint && npm test` successfully on 26 August 2026. |

> **Audit verdict:** PASS. There are no open CRITICAL, HIGH, or MEDIUM findings within Cryptography and Key Management, and you may proceed to Phase 3.
