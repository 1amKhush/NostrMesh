# NostrMesh Project Plan

## Implementation Status
- M0 (Bootstrap and Design Docs): completed
- M1 (Self-contained mesh-native stack): completed
  - Root `docker-compose.yml` with yggdrasil/db/cache/migrate/relay/blossom/api
  - Mesh-aware env bootstrap and discovery scripts
  - Health and smoke scripts aligned to `nostrmesh-*` services
- M2 (Mesh connectivity proof): completed with known external WARNs
  - `scripts/mesh-test.sh` validates mesh reachability + Blossom upload/download roundtrip
  - Relay publish/fetch steps may WARN due external `nostream-share` issues (tracked separately)
- M3 (Integration tests + demo): completed with known external SKIP/WARN paths
  - Added `tests/integration/metadata-roundtrip.test.ts`
  - Added `tests/integration/e2e-flow.test.ts`
  - Added `scripts/demo.sh` and `scripts/run-integration-tests.sh`
- M4 (Blossom integration and operations documentation): completed
  - Rewrote `docs/architecture.md` for mesh-native deployment model
  - Added `docs/runbook.md` with startup, diagnostics, and multi-node peering steps
  - Refreshed `docs/dependencies.md` with current stack/runtime contract
- M5 (NostrMesh API for Blob Store/Retrieve): completed
  - Structured API error envelope applied across blob and event routes
  - `GET /events/:eventId` now returns parsed metadata alongside event payload
  - Route-level contracts include explicit 400/404/410/422/502 code mapping
- M6 (Hardening and demo readiness): completed
  - Relay and blossom retry/backoff behavior added for publish/query/upload/download paths
  - Upload idempotency via `Idempotency-Key` replay cache and idempotent delete semantics
  - Added relay failure contract integration test and runbook backup procedures

## Goal
Build a distributed backend storage module over a Yggdrasil mesh network using:
- Nostr relay for event transport
- Blossom server for large blob storage
- A thin integration layer in this repository for orchestration, API, and docs

## Core Decision
Use the existing relay implementation as a local checkout under this repo at:
- `./nostream-share`

This repository (`NostrMesh`) will not re-implement relay internals. It will integrate and orchestrate them.

## Scope
- In scope:
  - Local and multi-node mesh setup with Yggdrasil
  - Relay startup and validation through `./nostream-share`
  - Publish/subscribe flow verification
  - Event-based metadata storage prototype
  - Blossom integration for blob upload/download
  - API in `NostrMesh` for store/retrieve using Nostr references
- Out of scope (initial milestone):
  - Production-grade federation and global replication policies
  - Full auth/billing/rate-limiting product features

## Proposed Repository Shape (NostrMesh)
- `docs/` architecture, protocol notes, runbooks
- `scripts/` orchestration scripts that call `./nostream-share`
- `api/` blob reference API service
- `tests/` integration and flow tests

## Architecture Overview
1. Client uploads blob to Blossom server.
2. API generates metadata event (content hash, mime, size, location pointer, owner pubkey, timestamp).
3. Metadata event is published to Nostr relay (running from `./nostream-share`).
4. Consumers subscribe via relay and resolve blob reference through API/Blossom.
5. Yggdrasil provides private IPv6 mesh transport between nodes.

## Reference Inputs from formstr-drive
Useful patterns adopted from `../formstr-drive`:
- Use kind `24242` auth events (NIP-98 style) for Blossom upload/get operations.
  - Include `t` tag (`upload` or `get`) and short `expiration` window (default 60 seconds).
- Use kind `34578` parameterized replaceable events for file metadata.
  - Set `d` tag to the blob hash so updates naturally replace older metadata.
  - Encrypt metadata content (current implementation uses `aead-v1` payloads), keeping pointers private by default.
- Use a metadata model that already works in practice:
  - `name`, `hash`, `size`, `type`, `folder`, `uploadedAt`, `server`, `encryptionKey`, optional `deleted`.
- Soft delete by publishing an updated metadata event with `deleted: true` (same `d` tag), instead of removing history.
- Optionally support Blossom server discovery via kind `36363` announcements (`d` tag contains server URL), merged with local defaults/allowlist.
- Publish to multiple relays and treat at least one publish acknowledgement as success; deduplicate fetch results by hash and latest timestamp.
- Normalize Blossom URLs and keep explicit handling for CORS/network failures in API responses and diagnostics.

## Milestones

### M0 - Bootstrap and Design Docs
Deliverables:
- Initial folder structure in this repo
- Architecture Decision Record: relay source is external `./nostream-share`
- Component diagram and sequence flow docs

Acceptance criteria:
- Anyone can understand boundaries between NostrMesh and nostream-share in under 10 minutes

### M1 - Local Yggdrasil + Relay Bring-up
Deliverables:
- Documented local setup for Yggdrasil node
- Connectivity validation steps (ping/peer/status)
- Relay started from `./nostream-share` using its existing compose/scripts

Acceptance criteria:
- Relay reachable over configured local endpoint
- Connectivity test logs captured in docs

### M2 - Basic Nostr Publish/Subscribe
Deliverables:
- Smoke scripts/tests for event publish and subscription
- Example event kinds for metadata and health checks
- Multi-relay publish strategy and deduplicated subscription results

Acceptance criteria:
- Event published by one client is observed by subscriber reliably
- Test evidence stored in `tests/` output or docs

### M3 - Event-backed Metadata Storage Prototype
Deliverables:
- Metadata schema for blob references in Nostr events
- Encoder/decoder utilities and validation rules
- Kind `34578` replaceable metadata events keyed by `d=<hash>`
- Soft-delete semantics (`deleted: true`) verified with replacement behavior

Acceptance criteria:
- Metadata round-trip works: publish -> fetch -> parse -> verify signature/hash pointers

### M4 - Blossom Integration for Large Blobs
Deliverables:
- Local Blossom server integration path
- Upload and retrieval flow tied to metadata events
- Integrity verification via content hash
- Kind `24242` short-lived auth events for Blossom upload/get

Acceptance criteria:
- Blob > relay message threshold is stored via Blossom and discoverable via Nostr reference

### M5 - NostrMesh API for Blob Store/Retrieve
Deliverables:
- API endpoint set (minimum):
  - `POST /blobs` upload blob + publish metadata event
  - `GET /blobs/:id` resolve metadata and return blob info/access path
  - `GET /events/:eventId` return parsed metadata event
- Error model and response contracts

Acceptance criteria:
- End-to-end: upload -> publish -> subscribe -> resolve -> download succeeds

### M6 - Hardening and Demo Readiness
Deliverables:
- Integration tests for happy path and failure modes
- Retry/idempotency behavior for publish and upload
- Ops runbook (start/stop, health checks, backup notes)

Acceptance criteria:
- Demo script runs from clean environment with documented steps

## Execution Plan by Week (Suggested)
- Week 1: M0 + M1
- Week 2: M2 + M3
- Week 3: M4 + M5
- Week 4: M6 + proposal packaging

## Risks and Mitigations
- External relay path drift (`./nostream-share` changes):
  - Pin to a known commit hash and document it in `docs/dependencies.md`
- Mesh networking instability:
  - Keep local fallback profile and add connectivity checks before tests
- Event/blobs inconsistency:
  - Make hash verification mandatory before serving blob references

## Competency Test Submission Checklist
- Architecture document with diagrams
- Proof of Yggdrasil connectivity
- Relay publish/subscribe demo evidence
- Blob upload/download using Blossom + Nostr references
- API contract and integration test results
- Short recorded demo or reproducible command log

## Immediate Next Actions
1. Upstream external relay defects tracked in `docs/external-repo-issues.md`.
2. Keep dependency pin and runbook synchronized with future stack changes.
3. Re-validate integration scripts after each `nostream-share` pin bump.
