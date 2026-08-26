# Phase 10 — Documentation, Deployment, Connector

**Status:** Completed; the package moves to the final security review for Sections 1–21.

## Phase 10 Deliverables

| Deliverable | Path | Verification |
|---|---|---|
| Server 1 code | `server1-upload/index.js` | Included in integration, crypto, and resume tests. |
| Server 2 code | `server2-relay/index.js` | Included in mTLS/replay/e2e. |
| Server 3 code | `server3-storage/index.js` | Included in e2e and final verification. |
| Connector app | `connector/index.js` | Interactive CLI that gathers the three nodes' data, generates configs, and launches them automatically. |
| Linux binary | `dist/three-server-connector-linux-x64` | ELF x86_64; tested with `--help` and `--generate` and launching the actual nodes. |
| Windows binary | `dist/three-server-connector-win-x64.exe` | PE32+ x64; packages the SQLite Windows x64 addon, and requires a final run test on the target Windows before production. |
| Architecture | `docs/ARCHITECTURE.md` | Defines trust boundaries, paths, and network interfaces. |
| Security | `docs/SECURITY.md` | Specifies controls, threat model, and incidents. |
| Keys | `docs/KEY_MANAGEMENT.md` | Specifies Vault/development/key rotation. |
| Deployment | `docs/DEPLOYMENT.md` | Specifies VPS/systemd/Firewall/production checklist. |

## Connector Application Guarantee

> After entering the address, port, certificates, key, and storage path for each node and pressing Continue in the CLI, the application does not request any additional manual setup. It validates the files, generates three-node configs, starts Server 3 then Server 2 then Server 1, and runs the encryption, authentication, and resume logic embedded in the servers automatically.

In a source environment, the Connector runs three Node processes. In the packaged binary, it runs the three nodes inside the same bundled process for Windows/Linux compatibility. In distributed production on separate VPSs, the source/binary is deployed to each node per `DEPLOYMENT.md` and the connection data and mTLS remain identical.

## Important operational note

The Linux binary is actually verified in this delivery. PE32+ cannot be executed in the current Linux environment; therefore acceptance testing on Windows x64 remains a required item before production deployment, this is not a defect found in the source code. The bundled addon has the Node 22 Windows x64 ABI matching the binary.
