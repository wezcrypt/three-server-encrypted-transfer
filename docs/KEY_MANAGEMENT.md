# Key Management and Encryption

## Envelope Encryption

For each file, Server 1 generates a random 32-byte **DEK**. It is used only during upload processing to encrypt each chunk using AES-256-GCM. The DEK is not written to the ciphertext file, remote manifest, log, or API response.

| Item | Location | Who can access | Lifetime |
|---|---|---|---|
| plaintext | stream/memory of Server 1 only | Server 1 process | During upload only; no plaintext temp file is created. |
| DEK | memory of Server 1 then wrapped | Server 1 only | buffer is wiped after operation; requires authorized future decryption. |
| wrapped DEK | `encryption_metadata` table in Server 1 DB only | Server 1 and Vault Transit per policy | Until file retention policy. |
| Master Key / Transit Key | Vault only in production | Vault; does not leave as plaintext to the application | Managed by Vault. |
| Vault Token | environment/secret manager for Server 1 only | Server 1 service account | As short-lived as possible; not logged. |

## Production mode: Vault Transit

The following values must be present in the environment of **Server 1 only**:

```bash
RUNTIME_ENV=production
KEY_PROVIDER=vault
VAULT_ADDR=https://vault.example.internal:8200
VAULT_TOKEN=<secret-from-service-account>
VAULT_TRANSIT_KEY=three-server-dek
MTLS_CRL_PATH=/etc/three-server/ca.crl.pem
```

The application calls `transit/encrypt/<key>` with a context constructed from `fileId`, and stores the ciphertext returned by Vault as the wrapped DEK. For future decryption, the same context must be used. If Vault is unavailable or returns an invalid response, the application should fail closed; there is no fallback to an environment master key.

### Suggested minimum Vault policy

```hcl
path "transit/encrypt/three-server-dek" { capabilities = ["update"] }
path "transit/decrypt/three-server-dek" { capabilities = ["update"] }
```

Create a separate policy and token for Server 1, and do not place the Vault address, token, or policy in the settings of Server 2/3. To limit blast radius, do not grant decrypt capability to APIs not included in the release until you implement a recovery layer with explicit ownership and approval.

## Development-only mode

`KEY_PROVIDER=development` allows a local base64 key for testing:

```bash
RUNTIME_ENV=development
KEY_PROVIDER=development
DEV_KMS_KEY_VERSION=v2
DEV_KMS_KEYS_JSON='{"v1":"<32-byte-base64>","v2":"<32-byte-base64>"}'
```

If you do not use `DEV_KMS_KEYS_JSON`, the application accepts `MASTER_KEY_B64` for a single key. The application forbids this provider when `RUNTIME_ENV=production`.

## Rotation and revocation

Vault Transit includes the key version in the wrapped ciphertext. Before rotating the transit key, ensure decrypt for older versions remains available per Vault policy. Rotate Vault tokens, certificates, and CRLs according to incident or organizational schedule. In development mode, `DEV_KMS_KEYS_JSON` supports reading the previous version to test migrations, but it is not a substitute for Vault.
