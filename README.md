# NostrMesh

Mesh-native encrypted storage backend built on:
- Nostr relay for metadata and pub/sub
- Blossom-compatible HTTP server for encrypted blobs
- Yggdrasil IPv6 mesh networking for NAT traversal

NostrMesh is designed so nodes behind home or office NAT are still reachable by peers on the mesh.

## Table Of Contents

- [What This Project Solves](#what-this-project-solves)
- [Architecture At A Glance](#architecture-at-a-glance)
- [Key Features](#key-features)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Validation Workflow](#validation-workflow)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Operations And Scripts](#operations-and-scripts)
- [Multi-Node Notes](#multi-node-notes)
- [Known Upstream Limitations](#known-upstream-limitations)
- [Troubleshooting Quick Hits](#troubleshooting-quick-hits)
- [Security Notes](#security-notes)
- [Additional Documentation](#additional-documentation)

## What This Project Solves

Traditional self-hosted relay/blob stacks break down under NAT and inbound network restrictions.
NostrMesh uses Yggdrasil as the networking substrate so every node can expose relay and blossom endpoints over mesh IPv6:

- Relay: `ws://[mesh-ip]:8008`
- Blossom: `http://[mesh-ip]:3000`

The API layer binds both systems into a practical upload, resolve, and download flow while preserving encrypted-at-rest semantics.

## Architecture At A Glance

### Runtime Components

| Service | Role | Port |
| --- | --- | --- |
| `yggdrasil` | Mesh identity and NAT traversal | `12345` listen |
| `db` | Relay persistence (PostgreSQL) | internal (`5432`) |
| `cache` | Relay cache/rate infra (Redis) | internal (`6379`) |
| `migrate` | Relay schema migrations | one-shot job |
| `relay` | Nostr relay runtime (`nostream-share`) | `8008` |
| `blossom` | Blob store + auth verification | `3000` |
| `api` | Upload/resolve/download integration API | `4000` |

### Data Planes

- Metadata plane: Nostr events (`kind 34578`, replaceable by `d=<sha256>`)
- Blob plane: Blossom content-addressed objects (`sha256`)
- Auth plane: Blossom auth events (`kind 24242`, signed, short expiration)

### Flow Summary

1. Client uploads file to API.
2. API encrypts file payload and uploads ciphertext to Blossom.
3. API emits encrypted metadata event to relay.
4. Client resolves metadata by hash or event ID.
5. API fetches encrypted blob, decrypts, and returns original payload.

## Key Features

- Mesh-native endpoint generation (`BLOSSOM_PUBLIC_URL` and `RELAY_PUBLIC_URL`)
- Encrypted blobs (AES-256-GCM) with per-file keys
- Encrypted metadata payloads (`aead-v1` envelope)
- Soft delete via replaceable metadata events (`deleted: true`)
- Structured API error contract (`error`, `code`, optional `details`)
- Retry and backoff for relay/blossom operations
- Upload idempotency with `Idempotency-Key` and conflict detection
- Health, smoke, mesh, integration, and demo scripts for reproducibility

## Repository Layout

```text
api/                  API service (TypeScript)
blossom/              Blossom-compatible server
docker/               Yggdrasil image assets
docs/                 Architecture, runbook, dependency contract
nostream-share/       Embedded relay runtime source
scripts/              Stack lifecycle, diagnostics, demos
tests/                Smoke and integration validations
docker-compose.yml    Full stack orchestration
```

## Prerequisites

Required host tools:

- Docker Engine with Compose v2 (`docker compose`)
- Bash
- `curl`
- `jq`
- `git`

Host constraints:

- Linux host with `/dev/net/tun`
- Permission to run containers with `NET_ADMIN`
- Ports available: `3000`, `4000`, `8008`, `12345`

## Quick Start

From repository root:

```bash
./scripts/stack-up.sh
```

Then verify:

```bash
./scripts/health-check.sh
./scripts/mesh-test.sh
```

What `stack-up.sh` handles for you:

1. Verifies dependencies and compose file.
2. Bootstraps relay checkout if missing.
3. Generates or updates `.env` via `scripts/init-env.sh`.
4. Starts all services in `docker-compose.yml`.
5. Discovers mesh IP and refreshes public URLs.
6. Runs health checks and prints local + mesh endpoints.

## Validation Workflow

### Smoke checks

```bash
./tests/smoke/relay-connectivity.sh
./tests/smoke/pubsub.sh
```

### Integration checks

```bash
./scripts/run-integration-tests.sh
```

### End-to-end demo

```bash
./scripts/demo.sh
```

The demo includes automatic fallback to mesh proof when known upstream relay publish behavior rejects replaceable events.

## API Reference

Base URL: `http://127.0.0.1:4000`

### Health

- `GET /health`

### Blob endpoints

- `POST /blobs`
  - multipart field: `file`
  - optional multipart field: `folder` (must start with `/`)
  - optional header: `Idempotency-Key`
  - response: `201` with `eventId`, `hash`, `downloadUrl`, `metadata`
- `GET /blobs/:hash`
  - response: metadata + download URL
- `GET /blobs/:hash/download`
  - response: decrypted binary payload
- `DELETE /blobs/:hash`
  - response: soft-delete event result (`alreadyDeleted` on idempotent replay)

### Event endpoints

- `GET /events/:eventId`
  - response: raw event and parsed metadata
- `GET /events?hash=<sha256>`
  - response: event list by metadata hash

### Error Envelope

Non-2xx responses return JSON:

```json
{
  "error": "human-readable message",
  "code": "machine_code",
  "details": {}
}
```

Typical status/code patterns:

- `400`: invalid hash/eventId/folder/idempotency key
- `404`: metadata or event not found
- `409`: idempotency key reused with different payload
- `410`: metadata/blob soft-deleted
- `422`: invalid persisted metadata event
- `502`: relay or blossom upstream failure

## Configuration

Main `.env` values managed by `scripts/init-env.sh`:

| Variable | Purpose |
| --- | --- |
| `SECRET` | Relay secret |
| `NOSTR_SECRET_KEY` | API signing + metadata encryption secret |
| `API_PORT` | API bind port |
| `RELAY_URL` / `RELAY_URLS` | Relay endpoints for API read/write |
| `BLOSSOM_URL` | Internal blossom URL used by API |
| `BLOSSOM_PUBLIC_URL` | Public/mesh blossom URL stored in metadata |
| `RELAY_PUBLIC_URL` | Public/mesh relay URL shown in output |
| `YGGDRASIL_LISTEN_PORT` | Mesh listen port |
| `RELAY_PUBLISH_ATTEMPTS` | Relay publish retry count |
| `RELAY_QUERY_ATTEMPTS` | Relay query retry count |
| `RELAY_RETRY_BASE_DELAY_MS` | Relay retry backoff base |
| `BLOSSOM_UPLOAD_ATTEMPTS` | Blossom upload retry count |
| `BLOSSOM_DOWNLOAD_ATTEMPTS` | Blossom download/head retry count |
| `BLOSSOM_RETRY_BASE_DELAY_MS` | Blossom retry backoff base |
| `IDEMPOTENCY_TTL_SECONDS` | Idempotency cache TTL |
| `IDEMPOTENCY_MAX_ENTRIES` | Idempotency cache capacity |

## Operations And Scripts

| Script | Purpose |
| --- | --- |
| `scripts/stack-up.sh` | Full start + env init + health report |
| `scripts/stack-down.sh` | Full shutdown (`-v` to remove volumes) |
| `scripts/health-check.sh` | HTTP, container, DB, cache, mesh checks |
| `scripts/mesh-test.sh` | Mesh connectivity + blob roundtrip proof |
| `scripts/demo.sh` | User-facing end-to-end walkthrough |
| `scripts/run-integration-tests.sh` | Integration test orchestration |
| `scripts/init-env.sh` | Secret and URL bootstrap |
| `scripts/discover-mesh-address.sh` | Resolve current mesh IPv6 |

## Multi-Node Notes

NostrMesh supports multi-node operation over Yggdrasil.

High-level process:

1. Start Node A and capture peer/public key details.
2. Update Node B Yggdrasil config with Node A peer and key.
3. Restart both nodes.
4. Verify cross-node relay and blossom reachability over mesh URLs.

Use the full operational walkthrough in `docs/runbook.md`.

## Troubleshooting Quick Hits

- Mesh address missing:
  - Check `nostrmesh-yggdrasil` logs and `/dev/net/tun` availability.
- Relay metadata publish errors:
  - Run `./scripts/health-check.sh` then `./scripts/mesh-test.sh`.
- Migration drift:
  - For disposable local runs, reset with `./scripts/stack-down.sh -v` then restart.

## Security Notes

- Blob access is authenticated with signed `kind 24242` events.
- Blob payloads are encrypted before persistence.
- Metadata payloads are encrypted before relay publish.
- Yggdrasil provides encrypted transport across mesh nodes.

Local dev note:

- Relay auth is intentionally disabled in generated local relay settings for deterministic smoke workflows.

## Additional Documentation

- `docs/architecture.md` for detailed system model and protocol assumptions
- `docs/runbook.md` for operations, backup, and troubleshooting procedures
- `docs/dependencies.md` for version pins and environment contract
