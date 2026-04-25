# Metadata Schema (Kind 34578)

## Event Envelope

NostrMesh stores blob metadata in Nostr kind `34578` parameterized replaceable events.

```json
{
  "kind": 34578,
  "pubkey": "<publisher-pubkey>",
  "created_at": 1710000000,
  "tags": [
    ["d", "<sha256-hash>"],
    ["client", "nostrmesh"],
    ["encrypted", "nip44"]
  ],
  "content": "<nip44-encrypted-json>"
}
```

## Tag Semantics

| Tag | Required | Value | Purpose |
| --- | --- | --- | --- |
| `d` | Yes | SHA-256 hash hex string | Replaceable identifier and blob lookup key |
| `client` | Yes | `nostrmesh` | Producer identification |
| `encrypted` | Yes | `nip44` | Declares payload format |

## Encrypted Content Schema

```ts
export interface BlobMetadata {
  name: string;
  hash: string;
  size: number;
  type: string;
  folder: string;
  uploadedAt: number;
  server: string;
  encryptionKey: string;
  deleted?: boolean;
}
```

Field definitions:
- `name`: original filename.
- `hash`: SHA-256 of stored blob payload.
- `size`: blob size in bytes.
- `type`: MIME type.
- `folder`: virtual folder path, default `/`.
- `uploadedAt`: unix timestamp (seconds or milliseconds, but one convention per deployment).
- `server`: Blossom base URL used for upload.
- `encryptionKey`: hex private key for per-file encryption strategy.
- `deleted`: optional soft-delete marker.

## Soft Delete
- Publish a new kind `34578` event with the same `d` tag (same hash).
- Set `deleted: true` in encrypted content.
- Consumers must treat the newest event for that `d` tag as authoritative.

## Round-Trip Validation Rules
- Event `kind` must be `34578`.
- Event must include valid `d`, `client`, and `encrypted` tags.
- `d` tag must equal `content.hash` after decryption.
- `hash` must match `/^[a-f0-9]{64}$/`.
- `server` must be a valid `http://` or `https://` URL.
- `size` must be non-negative integer.
- `name` must be non-empty.
- `folder` must start with `/`.

## Compatibility Contract
- This schema intentionally mirrors formstr-drive metadata semantics.
- NostrMesh should avoid adding required fields that break existing consumers.
- New fields should be additive and optional.
