# NostrMesh Runbook

## Scope
This runbook covers day-to-day operation of the self-contained NostrMesh stack in this repository:

- `yggdrasil`, `db`, `cache`, `migrate`, `relay`, `blossom`, `api`
- bootstrap and health scripts in `scripts/`
- smoke, mesh, integration, and demo validation flows

It also includes manual multi-node peering steps for Yggdrasil.

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
- Linux host with `/dev/net/tun` available for Yggdrasil
- Docker daemon permissions for the current user
- Ports `3000`, `4000`, `8008`, and `12345` free on host

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
- mesh endpoint checks are `OK` when Yggdrasil address is discovered

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
- tests may emit `SKIP` for known external relay publish issues
- runner still ends with `[integration] PASS` when all skips are known/expected

### Demo script (`scripts/demo.sh`)
Expected:
- full upload/download/delete path when relay publish is acknowledged

Known fallback:
- if relay publish is rejected with `All promises were rejected`, demo prints WARN and runs `scripts/mesh-test.sh` as fallback proof

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
- `YGGDRASIL_LISTEN_PORT`: ygg listen port (default `12345`)

Bootstrap/fallback controls:
- `NOSTREAM_REPO_URL`: source URL for bootstrapping `./nostream-share`
- `NOSTRMESH_ALLOW_NO_YGGDRASIL`: allows fallback behavior in selected scripts

After changing `.env`, reapply services:

```bash
docker compose --env-file .env -f docker-compose.yml up -d api blossom relay
```

## Logs and Diagnostics
Follow all core logs:

```bash
docker compose --env-file .env -f docker-compose.yml logs -f yggdrasil relay blossom api db cache
```

Check container status:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

## Troubleshooting

### 1) Yggdrasil mesh address not discovered
Symptoms:
- `scripts/discover-mesh-address.sh` returns empty
- mesh checks fail in health report

Actions:
1. Confirm yggdrasil container is running:
   ```bash
   docker ps --format '{{.Names}}' | grep -x nostrmesh-yggdrasil
   ```
2. Inspect ygg logs:
   ```bash
   docker logs --tail 200 nostrmesh-yggdrasil
   ```
3. Re-run env init and restart URL-dependent services:
   ```bash
   ./scripts/init-env.sh
   docker compose --env-file .env -f docker-compose.yml up -d blossom api
   ```

### 2) `/dev/net/tun` or `NET_ADMIN` related startup failure
Symptoms:
- yggdrasil container exits immediately

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

## Multi-Node Manual Peering (Yggdrasil)
These steps are manual and intended for controlled testing.

### Step 1: Start Node A and capture identity
On Node A:

```bash
./scripts/stack-up.sh
docker logs --tail 200 nostrmesh-yggdrasil
```

Capture:
- Node A public key
- Node A public peer endpoint (`tcp://<public-ip>:12345`)
- Node A mesh address from `scripts/discover-mesh-address.sh`

### Step 2: Generate Node B config
On Node B:

```bash
./scripts/stack-up.sh
./scripts/stack-down.sh
```

This ensures `yggdrasil-config/yggdrasil.conf` exists.

### Step 3: Add Node A as a peer on Node B
On Node B, edit `yggdrasil-config/yggdrasil.conf` and set:
- `Peers` to include Node A peer endpoint
- `AllowedPublicKeys` to include Node A public key

Example with `jq`:

```bash
jq '.Peers += ["tcp://<node-a-public-ip>:12345"] | .AllowedPublicKeys += ["<node-a-public-key>"]' \
  yggdrasil-config/yggdrasil.conf > /tmp/ygg.conf && mv /tmp/ygg.conf yggdrasil-config/yggdrasil.conf
```

Optional but recommended: add reciprocal peer/key entries on Node A.

### Step 4: Restart both nodes
On each node:

```bash
./scripts/stack-up.sh
```

### Step 5: Verify cross-node mesh reachability
From Node B host:

```bash
NODE_A_MESH="<node-a-mesh-ip>"
curl -fsS -H 'Accept: application/nostr+json' "http://[${NODE_A_MESH}]:8008" >/dev/null
curl -fsS "http://[${NODE_A_MESH}]:3000/health" >/dev/null
```

If both succeed, relay and blossom are reachable across NAT boundaries via mesh.

## Shutdown

```bash
./scripts/stack-down.sh
```

For full cleanup including volumes:

```bash
./scripts/stack-down.sh -v
```
