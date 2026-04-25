# NostrMesh Architecture

## Purpose
NostrMesh provides a backend storage module that combines:
- Nostr relay events for metadata and pub/sub
- Blossom-compatible blob storage for encrypted file data
- nostr-vpn (WireGuard) mesh networking for private distributed deployment

NostrMesh integrates with, but does not replace, the sibling relay project at `../nostream-share`.

## Boundaries

### Owned by NostrMesh
- Stack orchestration scripts (`scripts/`)
- Blob + metadata API (`api/`)
- Metadata schema and event semantics (`docs/metadata-schema.md`)
- Tests and runbooks (`tests/`, `docs/`)

### Reused from nostream-share
- Relay runtime and NIP support
- PostgreSQL and Redis infrastructure
- Existing ops scripts (`./scripts/start`, `./scripts/stop`)

### Reused from formstr-drive patterns
- Kind `24242` auth events for Blossom upload/get
- Kind `34578` parameterized replaceable metadata events
- `d=<sha256>` tag convention for blob-keyed metadata
- NIP-44 encrypted metadata payloads and soft-delete semantics

## Component Diagram

```mermaid
graph TB
    subgraph NostrMesh
        API[API Service :4000]
        Scripts[scripts/ stack-up/down, relay-up/down]
        Tests[smoke + integration tests]
    end

    subgraph NostreamShare[nostream-share sibling project]
        Relay[Nostr Relay :8008]
        DB[(PostgreSQL)]
        Cache[(Redis)]
        NVPN[nostr-vpn sidecar]
    end

    subgraph Blossom
        BServer[Blossom-compatible server :3000]
        BStore[(Blob filesystem)]
    end

    Client[Client or app] -->|REST| API
    API -->|WS publish/query| Relay
    API -->|HTTP PUT/GET| BServer
    Relay --> DB
    Relay --> Cache
    NVPN -. WireGuard tunnel .- DB
    BServer --> BStore
    Scripts --> Relay
    Scripts --> BServer
    Tests --> API
    Tests --> Relay
    Tests --> BServer
```

## Event Kinds Used

| Kind | Purpose | Replaceable | Notes |
| --- | --- | --- | --- |
| 24242 | Blossom auth token (NIP-98 style) | No | Tags include `t=upload|get` and short `expiration` |
| 34578 | Blob metadata | Parameterized | `d` tag is blob hash, payload encrypted with NIP-44 |
| 36363 | Blossom server announcements | Parameterized | Optional server discovery mode |

## Upload Sequence

```mermaid
sequenceDiagram
    participant C as Client
    participant A as NostrMesh API
    participant B as Blossom Server
    participant R as Relay

    C->>A: POST /blobs (multipart file)
    A->>A: Encrypt blob, prepare metadata
    A->>A: Build kind 24242 auth event
    A->>B: PUT /upload (ciphertext + Authorization)
    B-->>A: { sha256, size, url }
    A->>A: Build kind 34578 event (d=sha256)
    A->>R: Publish metadata event (multi-relay)
    R-->>A: first ack accepted as success
    A-->>C: { eventId, hash, metadata }
```

## Download Sequence

```mermaid
sequenceDiagram
    participant C as Client
    participant A as NostrMesh API
    participant R as Relay
    participant B as Blossom Server

    C->>A: GET /blobs/:hash
    A->>R: Query kind 34578 by #d=hash
    R-->>A: Latest replaceable metadata event
    A-->>C: metadata + download route

    C->>A: GET /blobs/:hash/download
    A->>A: Build kind 24242 auth event (t=get)
    A->>B: GET /:hash
    B-->>A: encrypted blob bytes
    A-->>C: blob stream (or proxied ciphertext)
```

## Network Notes
- Relay is expected at `ws://localhost:8008` in local mode.
- Blossom is expected at `http://localhost:3000` in local mode.
- `nostream-share` creates Docker network `nostream`; NostrMesh services should join this network for interop.
- `nostr-vpn` uses `network_mode: host` to manage the WireGuard `tun` interface natively and binds to tunnel IP (`10.44.x.y`).
