# Deployment and Operation

## Deployment requirements

Deploy each node on a separate VPS or service account. Do not share system users, storage paths, or Vault data between Server 1, Server 2, and Server 3. Install Node.js 22.13.x when running from source, or use the platform-packaged binary. The binary requires certificate/key/CA/CRL and a writable storage path; Node.js does not require the packaged path.

| Node | Suggested port | ingress policy | local secret |
|---|---:|---|---|
| Server 1 | 8443 | client/Reverse proxy | Vault token only in production; upload token. |
| Server 2 | 9443 | Server 1 addresses only | private key and node certificate only. |
| Server 3 | 10443 | Server 2 addresses only | private key and node certificate only. |

## Certificates

For development only:

```bash
npm install
npm run certs:dev
```

The command creates a CA and node certificates under `config/certs`. Do not use them in production. Issue the CA and production certificates via your institutional PKI, secure private keys with POSIX mode `0600`, and publish an up-to-date CRL. The production config must contain `tls.crlPath` for each node.

## Using the connector application

### Linux

```bash
chmod +x three-server-connector-linux-x64
./three-server-connector-linux-x64
```

### Windows

```powershell
.\three-server-connector-win-x64.exe
```

The interactive CLI presents ordered runtime fields and the CA/CRL path, then the address, port, certificate, key, and storage path for each of Server 1/2/3, followed by token and upload limit. On completion, it validates paths and values, writes permission-restricted node config files into the workspace, and starts the three nodes automatically. In development the application generates a development master DEK randomly inside the process environment if one is not present. In production you must provide Vault environment variables for Server 1.

For noninteractive setup:

```bash
./three-server-connector-linux-x64 --generate connector.json
# Edit connector.json with real values; do not put the Vault token in it
./three-server-connector-linux-x64 --config connector.json
```

## Running the source with systemd

When distributing the source code to separate nodes, create an independent JSON config for each node then use a similar systemd unit:

```ini
[Unit]
Description=Three Server Upload Node
After=network-online.target

[Service]
Type=simple
User=three-server1
Group=three-server1
WorkingDirectory=/opt/three-server-transfer
Environment=CONFIG_PATH=/etc/three-server/server1.json
EnvironmentFile=/etc/three-server/server1.env
ExecStart=/usr/bin/node /opt/three-server-transfer/server1-upload/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/three-server1

[Install]
WantedBy=multi-user.target
```

Create separate units for Server 2 and Server 3 with appropriate `ExecStart`, `CONFIG_PATH`, and service path. Do not use the root user. If you use nginx in front of Server 1, forward HTTPS to Server 1 or ensure that TLS between nginx and Server 1 is trusted; do not place Server 2/3 behind a public proxy.

## Pre-production checklist

| Action | Required |
|---|---|
| `KEY_PROVIDER=vault` and a narrow Vault policy on Server 1 | Yes |
| No `MASTER_KEY_B64` and `DEV_KMS_KEYS_JSON` in production | Yes |
| Production CRL is correct and tested with a revoked certificate | Yes |
| Private keys have mode 0600 and are owned by the service account | Yes |
| Firewall allows only Server 1→2 and Server 2→3 | Yes |
| Separate encrypted volume for each storage path | Yes |
| Encrypted backup for SQLite and Storage Server 3 | Yes |
| `npm test` and `npm run test:security` and dependency audit in CI | Yes |
| Load and network-failure testing at production scale | Yes |
