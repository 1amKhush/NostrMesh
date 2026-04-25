# NostrMesh Runbook

## Scope
This runbook covers day-to-day operation of the self-contained NostrMesh stack in this repository:

- `nvpn` (nostr-vpn), `db`, `cache`, `migrate`, `relay`, `blossom`, `api`
- bootstrap and health scripts in `scripts/`
- smoke, mesh, integration, and demo validation flows

It also includes the two-node PoC checklist and peering steps for nostr-vpn.

## Prerequisites
Install and verify these host tools:

```bash
docker --version
docker compose version
bash --version
curl --version
jq --version
git --version
```

Host requirements:
- Linux host with `/dev/net/tun` available for WireGuard (nostr-vpn)
- Docker daemon permissions for the current user
- Ports `3000`, `4000`, `8008` free on host

## Quick Start (Single Node)
From repository root:

```bash
./scripts/stack-up.sh
./scripts/health-check.sh
./scripts/mesh-test.sh
```

What `stack-up.sh` does:
1. Verifies required tools and compose file.
2. Bootstraps `./nostream-share` if missing.
3. Ensures relay settings exist and disables relay auth for local smoke/dev flows.
4. Generates/updates `.env` via `scripts/init-env.sh`.
5. Builds and starts full compose stack.
6. Discovers mesh address and refreshes public URLs if available.
7. Runs health checks.

Observed startup footer includes:
- `NostrMesh stack ready:`
- local API/Relay/Blossom endpoints
- `Relay public` and `Blossom public` values from `.env`
- mesh endpoint lines when address discovery succeeds

## Service Endpoints
After successful startup:

- API local: `http://127.0.0.1:4000`
- Relay local: `ws://127.0.0.1:8008`
- Blossom local: `http://127.0.0.1:3000`
- Relay mesh: `ws://[<mesh-ip>]:8008`
- Blossom mesh: `http://[<mesh-ip>]:3000`

Discover current mesh address any time:

```bash
./scripts/discover-mesh-address.sh
```

## Lifecycle Commands

```bash
# Start / stop full stack
./scripts/stack-up.sh
./scripts/stack-down.sh

# Health and mesh checks
./scripts/health-check.sh
./scripts/mesh-test.sh

# Demo and integration checks
./scripts/demo.sh
./scripts/run-integration-tests.sh

# Smoke tests
./tests/smoke/relay-connectivity.sh
./tests/smoke/pubsub.sh
```

## Validation Expectations

### `scripts/health-check.sh`
Expected:
- `relay-http`, `blossom-http`, `api-http` are `OK`
- all `nostrmesh-*` containers are `OK`
- mesh endpoint checks are `OK` when tunnel IP is discovered

### `scripts/mesh-test.sh`
Expected:
- `relay-mesh-http`, `blossom-mesh-health`, `api-local-health` are `OK`
- blob upload/download/decrypt integrity checks are `OK`

Known behavior:
- metadata publish/fetch can return `WARN` when upstream relay defects are hit.
- this is tracked in `docs/external-repo-issues.md`.

Observed output labels include `OK`, `WARN`, and `INFO` rows, ending with `[mesh-test] PASS` when integrity checks pass.

### Integration tests (`scripts/run-integration-tests.sh`)
Expected:
- tests run via `api/node_modules/.bin/tsx`
- includes `relay-failure-contract` scenario with isolated API process and unreachable relay
- tests may emit `SKIP` for known external relay publish issues
- runner still ends with `[integration] PASS` when all skips are known/expected

### Demo script (`scripts/demo.sh`)
Expected:
- full upload/download/delete path when relay publish is acknowledged

Known fallback:
- if relay publish is rejected with `All promises were rejected`, demo prints WARN and runs `scripts/mesh-test.sh` as fallback proof

## API Reliability Behaviors

`POST /blobs` supports optional `Idempotency-Key` header:
- accepted charset: `[A-Za-z0-9._:-]`, max `128` chars
- successful responses are cached for `IDEMPOTENCY_TTL_SECONDS`
- replaying the same key returns the original `201` response body
- replaying the same key with a different payload returns `409 idempotency_key_conflict`

Retry defaults (exponential backoff) are controlled by `.env`:
- relay publish/query retries: `RELAY_PUBLISH_ATTEMPTS`, `RELAY_QUERY_ATTEMPTS`, `RELAY_RETRY_BASE_DELAY_MS`
- blossom upload/download retries: `BLOSSOM_UPLOAD_ATTEMPTS`, `BLOSSOM_DOWNLOAD_ATTEMPTS`, `BLOSSOM_RETRY_BASE_DELAY_MS`

## Environment Variables
The root `.env` is managed by `scripts/init-env.sh`.

Core variables:
- `SECRET`: relay secret
- `NOSTR_SECRET_KEY`: API signing/encryption key (64 hex chars)
- `API_PORT`: API port (default `4000`)
- `RELAY_URL` or `RELAY_URLS`: relay URLs for API reads/writes
- `BLOSSOM_URL`: internal blossom URL for API
- `BLOSSOM_PUBLIC_URL`: URL written to metadata `server` field
- `RELAY_PUBLIC_URL`: informational relay URL shown by scripts

Bootstrap/fallback controls:
- `NOSTREAM_REPO_URL`: source URL for bootstrapping `./nostream-share`
- `NOSTRMESH_ALLOW_NO_TUNNEL`: allows fallback behavior in selected scripts

After changing `.env`, reapply services:

```bash
docker compose --env-file .env -f docker-compose.yml up -d api blossom relay
```

## Logs and Diagnostics
Follow all core logs:

```bash
docker compose --env-file .env -f docker-compose.yml logs -f nvpn relay blossom api db cache
```

Check container status:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

## Backup Notes
Backup the durable state before risky upgrades, schema resets, or cleanup operations.

### PostgreSQL logical backup

```bash
mkdir -p backups
docker exec -i nostrmesh-db pg_dump -U nostr_ts_relay nostr_ts_relay > backups/nostrmesh-db-$(date +%Y%m%d-%H%M%S).sql
```

### Redis snapshot backup

```bash
mkdir -p backups
docker exec -i nostrmesh-cache redis-cli -a nostr_ts_relay --rdb /data/backup.rdb
docker cp nostrmesh-cache:/data/backup.rdb backups/nostrmesh-redis-$(date +%Y%m%d-%H%M%S).rdb
```

### Blossom blob store backup

```bash
mkdir -p backups
docker run --rm -v nostrmesh_blossom-data:/from -v "$PWD/backups":/to alpine sh -c 'tar -czf /to/nostrmesh-blossom-$(date +%Y%m%d-%H%M%S).tar.gz -C /from .'
```

## Troubleshooting

### 1) Tunnel IP / Mesh address not discovered
Symptoms:
- `scripts/discover-tunnel-ip.sh` returns empty
- mesh checks fail in health report

Actions:
1. Confirm nostr-vpn container is running:
   ```bash
   docker ps --format '{{.Names}}' | grep -x nostrmesh-vpn
   ```
2. Inspect nvpn logs:
   ```bash
   docker logs --tail 200 nostrmesh-vpn
   ```
3. Re-run env init and restart URL-dependent services:
   ```bash
   ./scripts/init-env.sh
   docker compose --env-file .env -f docker-compose.yml up -d blossom api
   ```

### 2) `/dev/net/tun` or `NET_ADMIN` related startup failure
Symptoms:
- nostr-vpn container exits immediately

Actions:
1. Verify host TUN device:
   ```bash
   ls -l /dev/net/tun
   ```
2. Ensure Docker host policy allows `NET_ADMIN` and TUN device pass-through.
3. Restart stack:
   ```bash
   ./scripts/stack-down.sh
   ./scripts/stack-up.sh
   ```

### 3) Relay metadata publish failures (`All promises were rejected`)
Symptoms:
- API upload/delete errors include `All promises were rejected`
- mesh/integration scripts show publish/fetch `WARN` or `SKIP`

Actions:
1. Confirm local service health still passes:
   ```bash
   ./scripts/health-check.sh
   ```
2. Confirm blossom roundtrip still works:
   ```bash
   ./scripts/mesh-test.sh
   ```
3. Track as external dependency issue in `docs/external-repo-issues.md`.

### 4) Migration/index errors after schema drift
Symptoms:
- `migrate` service fails repeatedly

Actions:
1. Check migrate logs:
   ```bash
   docker logs --tail 200 nostrmesh-migrate
   ```
2. For disposable local environments only, reset persistent volumes:
   ```bash
   ./scripts/stack-down.sh -v
   ./scripts/stack-up.sh
   ```

## Two-Node PoC Checklist (nostr-vpn)
These steps outline setting up two nodes (Node A and Node B) in a private `nostr-vpn` mesh and configuring PostgreSQL FDW to distribute relay events across both.

### Step 1: Initialize the Mesh Network on Node A
On Node A, create the `nostr-vpn` network and generate an invite:

```bash
./scripts/mesh-init.sh
```

This script creates `./nvpn-config`, initializes the node as a participant, and prints a **Mesh Invite Link**. Note down this link.

### Step 2: Start Node A
Start the full stack on Node A:

```bash
./scripts/stack-up.sh
```

Node A is now running on a specific `10.44.x.y` tunnel IP. You can verify it with `./scripts/health-check.sh` and note the `Blossom mesh` IP.

### Step 3: Join the Mesh from Node B
On Node B, initialize the network by joining using the invite link from Node A:

```bash
./scripts/mesh-init.sh "<INVITE_LINK_FROM_NODE_A>"
```

This joins Node B to the private mesh network created by Node A.

### Step 4: Start Node B
Start the full stack on Node B:

```bash
./scripts/stack-up.sh
```

Note Node B's tunnel IP using:

```bash
./scripts/discover-tunnel-ip.sh
```

### Step 5: Verify Mesh Connectivity
From Node B, ensure Node A's Blossom server is reachable over the WireGuard tunnel:

```bash
curl -fsS "http://<NODE_A_TUNNEL_IP>:3000/health"
```

### Step 6: Setup FDW from Node A to Node B
On Node A, configure the Foreign Data Wrapper to route a partition of its events to Node B's database over the WireGuard tunnel.
Use the deterministic FDW setup script:

```bash
# E.g. forward all events from timestamp 0 to MAXVALUE to node_b
./scripts/setup-fdw.sh <NODE_B_TUNNEL_IP> node_b 0 MAXVALUE
```

Node A's PostgreSQL will now natively fan-out queries and storage across the WireGuard tunnel to Node B's PostgreSQL partition.

## Shutdown

```bash
./scripts/stack-down.sh
```

For full cleanup including volumes:

```bash
./scripts/stack-down.sh -v
```
