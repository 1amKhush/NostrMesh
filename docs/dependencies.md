# NostrMesh Dependencies

## External Repository Pin

| Dependency | Current Pin | Notes |
| --- | --- | --- |
| `nostream-share` | `88edd722833075b05a469b6437d9f78a256334b8` | Embedded at `./nostream-share` and used as relay runtime source |

The checkout can be bootstrapped via git submodule, configured remote clone, or local fallback clone through `scripts/common.sh`. Treat relay behavior changes as external upgrades and re-validate scripts/tests when bumping this pin.

## Runtime Requirements

| Component | Minimum Practical Requirement | Why it is required |
| --- | --- | --- |
| Docker Engine | Modern Docker with Compose v2 support | All services run in containers |
| Docker Compose plugin | `docker compose` command available | Required by orchestration scripts |
| Bash | POSIX shell + bash features | All `scripts/*.sh` helpers |
| `curl` | Available on host | Health checks, demo, smoke scripts |
| `jq` | Available on host | JSON parsing in mesh/health scripts |
| `git` | Recommended | Auto-bootstrap of `nostream-share` checkout |

## Container and Service Versions

| Service | Version / Source | Where pinned |
| --- | --- | --- |
| PostgreSQL | `postgres:16-alpine` | `docker-compose.yml` (`db`) |
| Redis | `redis:7.0.5-alpine3.16` | `docker-compose.yml` (`cache`) |
| Migrations runner | `node:22-alpine` | `docker-compose.yml` (`migrate`) |
| Relay app | `nostream` package `2.1.0` from `nostream-share` | `nostream-share/package.json` |
| API app runtime | Node 22 distroless image | `api/Dockerfile` |
| Blossom app runtime | Node 22 distroless image | `blossom/Dockerfile` |
| Yggdrasil | Alpine package (`alpine:3.20`, fallback edge/community) | `docker/yggdrasil/Dockerfile` |

## Environment Contract

### Root `.env` (managed by `scripts/init-env.sh`)
- `SECRET`: relay secret used by `nostream-share`
- `NOSTR_SECRET_KEY`: API signing/encryption secret
- `API_PORT`: API host port (default `4000`)
- `RELAY_URL` / `RELAY_URLS`: relay URLs used by API publish/query logic
- `BLOSSOM_URL`: internal blossom URL used by API
- `BLOSSOM_PUBLIC_URL`: mesh/public blossom URL written into metadata
- `RELAY_PUBLIC_URL`: mesh/public relay URL printed by startup scripts
- `YGGDRASIL_LISTEN_PORT`: yggdrasil listen port (default `12345`)
- `RELAY_PUBLISH_ATTEMPTS`: retry attempts for relay publish operations (default `3`)
- `RELAY_QUERY_ATTEMPTS`: retry attempts for relay query operations (default `2`)
- `RELAY_RETRY_BASE_DELAY_MS`: exponential backoff base delay for relay retries (default `250`)
- `BLOSSOM_UPLOAD_ATTEMPTS`: retry attempts for blossom upload operations (default `3`)
- `BLOSSOM_DOWNLOAD_ATTEMPTS`: retry attempts for blossom download/head operations (default `2`)
- `BLOSSOM_RETRY_BASE_DELAY_MS`: exponential backoff base delay for blossom retries (default `250`)
- `IDEMPOTENCY_TTL_SECONDS`: cache retention for upload `Idempotency-Key` replay responses (default `600`)
- `IDEMPOTENCY_MAX_ENTRIES`: upper bound for in-memory idempotency cache entries (default `2000`)

### Bootstrap controls
- `NOSTREAM_REPO_URL`: overrides remote source used for bootstrapping `./nostream-share`
- `NOSTRMESH_ALLOW_NO_YGGDRASIL`: allows degraded local fallback behavior in selected scripts

## Compatibility Notes
- API metadata events use kind `34578` with `d=<sha256>` replacement semantics.
- Metadata encryption format is currently `aead-v1` (AES-256-GCM), not NIP-44.
- Relay publish/fetch reliability for replaceable metadata is currently affected by tracked upstream defects in `docs/external-repo-issues.md`.
