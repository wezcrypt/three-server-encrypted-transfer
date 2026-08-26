# Phase 3 — Setting up mTLS and Identity

**Build status:** Complete.
**Next step:** Focused audit session for Section 5 of the guide, before building the server APIs.

## Implementation

| Item | Implementation | Constraint |
|---|---|---|
| Internal CA | Development script generates an RSA-4096 CA and separate RSA-3072 certificates for `server1`/`server2`/`server3` | Private keys are written with permission `0600`, and no certificate or key is checked into code. |
| Certificate usage | Each certificate has `serverAuth` and `clientAuth`, and an SAN specific to the node identity | Each node can act as a TLS server and a TLS client within the mTLS path. |
| mTLS handshake | `requestCert: true` and `rejectUnauthorized: true` on server and client | A connection without a trusted certificate is rejected before the API handler. |
| TLS boundary | TLS 1.3 as a minimum | No fallback to older TLS versions. |
| Application-level verification | `verifyRequestPeer` and `verifyResponsePeer` check socket authorization and CN/SAN for the expected identity | A valid certificate for one node does not authorize calling an endpoint that requires a different role. |
| Internal client | `mtlsRequest` accepts HTTPS only and verifies the server identity after the handshake | Prevents misrouting Relay/Storage to an unexpected endpoint. |

## Executed tests

| Test | Status | Result |
|---|---|---|
| Client `server1` authenticated to `server2` with `server2` verifying `server1` | PASS | 200 response and identity=`server1`. |
| Client expects `server3` but connects to a server presenting `server2`'s certificate | PASS | Client rejects the response due to identity mismatch. |
| Source linting check | PASS | `npm run lint`. |

## Manual test checklist

| Test | Action | Expected result |
|---|---|---|
| Client without certificate | Call Server 2's port with plain TLS (no client cert) | Handshake failure. |
| Certificate from another CA | Present a client certificate issued by an untrusted CA | Handshake failure. |
| `server3` certificate on endpoint invoked by `server1` | Attempt to call API Server 2 using `server3`'s certificate | HTTP 403 rejected due to `MTLS_IDENTITY_MISMATCH`. |
| Expired certificate | Replace a node's certificate with an expired certificate | Handshake failure. |
| Incomplete production setup | Remove `ca` or `cert` or `key` | Fail to boot safely before opening the port. |

> **Release limitations:** The certificate script is intended for development and testing only. Production requires a managed internal CA and a documented certificate issuance, renewal, and revocation policy in `DEPLOYMENT.md`.

## References

[1] [Node.js TLS API](https://nodejs.org/api/tls.html)
[2] [OWASP TLS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html)
