# Center Audit — mTLS and PKI

**Review scope:** `config/generate-dev-certs.js`, `shared/mtls.js`, and mTLS tests.
**Review basis:** No code was modified during the session.
**Interim verdict:** There is one HIGH finding and one MEDIUM finding that must be remediated before the servers' APIs.

## Passed checks

| Item | Result | Evidence |
|---|---|---|
| Mutual authentication | PASS | `requestCert: true` and `rejectUnauthorized: true` on the server. |
| Client verification of CA | PASS | `rejectUnauthorized: true` and CA specified on the client. |
| Blocking unencrypted internal transport | PASS | `mtlsRequest` rejects every protocol except `https:`. |
| Application-level identity | PASS | Handshake alone is not sufficient; the application verifies CN/SAN for the required role. |
| Legacy TLS versions | PASS | `minVersion: TLSv1.3`. |
| Behavioral tests | PASS | server1→server2 succeeded and expected rejection of server3's identity when connecting to server2. |
| Acceptance of alternate node certificate | PASS by design | Endpoint requires an explicit role and does not rely solely on any CA-signed certificate. |

## High-risk findings

1. **[HIGH] No enforced certificate revocation mechanism in production mode.**

   | Item | Analysis |
   |---|---|
   | Location | `shared/mtls.js`, function `loadMtlsMaterial` and TLS options. |
   | Problem | The handshake verifies the trust chain and validity, but a CRL is neither loaded nor enforced in production. A stolen node certificate remains accepted until it expires. |
   | Impact | An attacker who possesses the private key and a valid certificate for a node can impersonate that node during the certificate's validity period. |
   | Exploit scenario | Theft of server1's certificate; the attacker connects to Server 2 using a certificate still signed by the CA and there is no revocation list to block it. |
   | Required remediation | Support `MTLS_CRL_PATH` and load it on both TLS server and client, and fail startup in production if it is absent. Document CRL issuance and renewal. |

## Medium-risk findings

1. **[MEDIUM] mTLS material loader does not locally check private key permissions.**

   | Item | Analysis |
   |---|---|
   | Location | `shared/mtls.js`, function `readPem`. |
   | Problem | The application accepts a private key whose permissions may be overly permissive on POSIX systems. |
   | Impact | Another local user could copy the node's certificate and private key and impersonate the node. |
   | Required remediation | Check `keyPath` permissions on POSIX and reject any group/world read/write/execute; enforce `0600` permissions in the certificate script and document this requirement. |

## Remediation decision

> Do not proceed to Phase 4 before addressing both findings. Mandatory CRL verification will be added for production and private key permission checks will be implemented without weakening `rejectUnauthorized` or the CN/SAN identity checks.

## References

[1] [Node.js TLS: CRL option](https://nodejs.org/api/tls.html)
[2] [OWASP TLS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html)

## Findings closure after review

After documenting the two findings, `crl` support was added to the TLS material for both ends of the connection. Production mode fails before opening any port when `MTLS_CRL_PATH` is absent. The PEM key loader on POSIX now verifies there are no group/world permissions. A test `production mTLS configuration fails closed without a CRL` was added, and the three integration tests passed.

| Finding | Status after fix | Verification |
|---|---|---|
| HIGH-1: Absence of CRL | CLOSED | Production test without a CRL fails closed. |
| MEDIUM-1: private key permissions | CLOSED | POSIX condition `mode & 0o077 == 0`, and development certificates are written with mode `0600`. |

> **Audit verdict:** PASS. There are no open CRITICAL, HIGH, or MEDIUM findings in the mTLS/PKI review, and Phase 4 may proceed.
