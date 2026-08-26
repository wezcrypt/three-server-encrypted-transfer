# Security Review Report

## Executive Summary

**Overall risk: HIGH**
**Production readiness: Not ready**

I reviewed the final artifacts: source code, config, migrations, endpoints, state machine, encryption, mTLS, logging, tests, binaries, and operational documentation. The project tests passed **15/15**, the security tests passed **3/3**, and the result of `npm audit --omit=dev --audit-level=low` is **0 vulnerabilities** on 26 August 2026. There are no open Critical findings. Production deployment remains not ready due to one High finding related to bootstrapping the connector application on separate VPSes, and two Medium findings related to filesystem/database atomicity and Windows testing.

## Critical findings (Critical)

There are no open Critical findings. I did not find a path that would allow Server 2 or Server 3 to decrypt ciphertext or access the DEK/Master Key, nor reuse an IV with a single DEK, nor disable `rejectUnauthorized`, nor delete confirmed ciphertext before `STORED`.

## High findings (High)

1. **[HIGH] The connector application does not provide remote bootstrap to three independent VPSes via a documented management channel.**
   - **Location:** `connector/index.js`, function `launch`, and the document `DEPLOYMENT.md`.
   - **Issue:** The packaged binary runs the three nodes locally within a single process for local/experimental operation. The intended production topology—where each node runs on an independent VPS—requires distributing source or binary/config to each VPS per the deployment guide. The application does not provide a documented management channel (SSH/mTLS) or an agent capable of copying the file, installing the service, and starting the process remotely based solely on address/port/certificate.
   - **Impact:** An operator may assume that entering VPS addresses into the Connector is sufficient for remote deployment, resulting in unintended local execution or a non-isolated topology. This is an architectural/operational risk rather than direct plaintext disclosure.
   - **Exploitation scenario:** Running the Connector on an administrative host with external hosts listed does not install or start the service on the target VPSes; instead a co-located process may run that violates isolation policies.
   - **Proposed fix:** Add a separate secure bootstrap channel that relies on SSH with constrained service-account keys or a preinstalled mTLS management agent on each VPS, with host-key fingerprint validation, an allow-list, and a confirmation review before executing deployment. A safe alternative: produce per-VPS packaged binary/config and use Ansible/Terraform/CI-driven pipelines.

## Medium findings (Medium)

1. **[MEDIUM] There is no single atomic transaction that includes file fsync and SQLite across the filesystem.**
   - **Location:** `shared/http-utils.js` and `shared/database.js` and chunk save operations.
   - **Issue:** The chunk write performs an `fsync` and then records the DB transaction, which is the correct ordering to avoid confirming an unwritten chunk, but it does not provide an atomic transaction that spans the filesystem and the database.
   - **Impact:** A power loss during a narrow window may leave a file present without a DB row, or a DB row that does not match an actual file after a filesystem failure; resume handles most cases but requires validation on reboot.
   - **Exploitation scenario:** Crash after write/rename and before commit, or during a filesystem failure.
   - **Proposed fix:** Add startup reconciliation that removes/isolates orphan files and re-hashes chunks documented in the DB before resuming, and use a directory fsync after rename on platforms that support it.

2. **[MEDIUM] No actual acceptance test was executed for the Windows x64 exe.**
   - **Location:** `dist/three-server-connector-win-x64.exe`.
   - **Issue:** The current environment is Linux-only. The PE32+ build and the inclusion of the Windows SQLite Node 22 x64 addon were verified, but a real Windows lifecycle was not executed.
   - **Impact:** Potential runtime/ACL/native addon issues on Windows may not surface in Linux testing.
   - **Exploitation scenario:** Not a direct exploit; runtime/installation/permission issues may cause the service to be unavailable or apply unexpected permissions.
   - **Proposed fix:** Run CI acceptance on Windows Server / Windows 11 x64: exercise `--generate`, `--config`, health checks, a small upload, and test ACLs for config and certificates.

## Low findings (Low)

1. **[LOW] The non-interactive example requires token review before execution.**
   - **Location:** `connector/index.js`, `exampleConfig`.
   - **Issue:** The `--generate` file contains an illustrative placeholder for the upload token; if an operator uses it as-is the token may be predictable.
   - **Impact:** Weak authentication of Server 1 in development or production if the example is not modified.
   - **Proposed fix:** Replace the placeholder with runtime generation of a random token when loading the example, or reject the known value. **Status: CLOSED**; the value `__GENERATE_SECURE_TOKEN_AT_RUNTIME__` is now an explicit generator for a 32-byte random token at config load, and the token value is not usable by itself.

## Encryption review

Encryption: PASS
Key Management: PASS
Nonce/IV handling: PASS
Authentication tags: PASS

The application uses standard AES-256-GCM with a 32-byte random DEK per file. The IV consists of an 8-byte random prefix with a 32-bit index, and AAD binds the record to the file, rotation, sequence, and length. Tampering tests, wrong-AAD tests, and differing-IV tests succeeded. Vault is enforced in production and the development provider is rejected; no key provider is available on Server 2/3.

## mTLS / PKI review

mTLS: PASS
Certificate validation: PASS
Identity verification: PASS
Rotation: PASS

Internal connections enforce TLS 1.3, require client certificate and CA, and set `rejectUnauthorized=true`. The application also verifies CN/SAN for role. Production refuses to boot without a CRL, and checks private-key mode on POSIX. Real CRL and renewal tests in a production-like environment are still required.

## Data loss review

Source deletion safety: PASS
Resume: PASS
Crash recovery: PASS

Server 1 does not create plaintext temporary files nor delete the source. It only deletes temporary ciphertext after the final `STORED` reply. The relay does not delete chunks before storage confirmation. The test of Storage unavailable and subsequent recovery succeeded and demonstrates that ciphertext persists prior to confirmation. The medium filesystem/DB reconciliation item above remains required for extreme power-loss tolerance.

## Recovery review

Download security: PASS (not exposed; there is no retrieval endpoint in this release)
Key authorization: PASS (no external decrypt API)
Plaintext isolation: PASS

Blocking retrieval is intentional in this release to avoid opening a decryption path without an identity and ownership/authorization layer. Any future retrieval endpoint must undergo independent design and audit.

## Dependencies review

`npm audit --omit=dev --audit-level=low` returned **found 0 vulnerabilities**. Operational dependencies are `better-sqlite3`, `pino`, `zod`, and `@yao-pkg/pkg`. Use a lockfile to pin versions and run audit in CI before each release; do not automatically bump packages without testing binary/native addons.

## Architectural issues

The primary open architectural issue is that the control interface does not have a secure remote deployment channel to independent VPSes. The servers themselves can be deployed separately according to the guide, but a "one-button" remote deployment requires credentials/agents that are not provided and must not be assumed. The release also does not provide a plaintext retrieval path, which is a deliberate attack-surface reduction rather than a defect.

## Required fixes (ranked by priority)

1. Implement documented and constrained remote bootstrap (SSH / mTLS agent) or adopt an official infrastructure pipeline to run the three VPSes independently from a single interface.
2. Execute an actual Windows x64 acceptance test for the exe, including ACL checks and native SQLite lifecycle.
3. Implement startup filesystem/SQLite reconciliation and directory fsync where available.
4. Perform CRL revocation tests, Vault policy/rotation, and a production-like staging load/test.

## Security tests required before production

| Test | Status |
|---|---|
| e2e encryption + plaintext isolation | PASS locally. |
| mTLS identity mismatch | PASS locally. |
| replay conflicting manifest | PASS locally. |
| path traversal and chunk validation | PASS locally. |
| outage + resume | PASS locally. |
| Windows binary acceptance | Required. |
| Vault Transit with production policy | Required. |
| CRL revocation on live certificate | Required. |
| 10/50/90% network cut and power-loss filesystem test | Required. |
| load/flood/quota stress test | Required. |
| remote three-VPS deployment exercise | Required. |

## Final verdict

**Not production ready** until the High finding concerning remote bootstrap is addressed and Windows/Vault/CRL/production-tolerance tests are executed. The current code is suitable for development experiments and for manual controlled deployment to three nodes per `DEPLOYMENT.md` after implementing production controls.
