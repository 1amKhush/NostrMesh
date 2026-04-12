# Reference: formstr-drive Conventions

This document records what NostrMesh adopts from the sibling `../formstr-drive` implementation.

## Adopted Verbatim

### 1) Kind 24242 auth events for Blossom operations
- Create short-lived auth events for `upload` and `get` actions.
- Include tags:
  - `t` = `upload` or `get`
  - `expiration` = unix timestamp, usually now + 60 seconds
- Send header: `Authorization: Nostr <base64-json-signed-event>`

### 2) Kind 34578 metadata as parameterized replaceable events
- Store metadata in kind `34578`.
- Use `d=<sha256>` tag as the replaceable key.
- Publish updated metadata with the same `d` tag for rename/move/delete semantics.

### 3) Soft-delete behavior
- Do not hard-delete metadata records.
- Publish replacement metadata with `deleted: true`.

### 4) Interop-first filtering
- Query by kind + author + tags, then decrypt and validate.
- Do not hard-filter out events only by client tag.

## Adopted with Adaptation

### 1) Encryption strategy
- formstr-drive uses browser WebCrypto + per-file keypairs.
- NostrMesh keeps per-file key concept but runs on server-side Node crypto primitives.
- Preserve payload and key-field compatibility (`encryptionKey` as hex).

### 2) Relay strategy
- formstr-drive publishes to multiple relays and treats first ack as success.
- NostrMesh follows the same strategy but adds retry queue and structured logging for backend reliability.

### 3) Blossom server discovery
- formstr-drive optionally consumes kind `36363` announcements.
- NostrMesh will treat discovery as optional and combine with static allowlist/config.

## Data Model Compatibility

NostrMesh metadata payload fields remain aligned with formstr-drive:
- `name`
- `hash`
- `size`
- `type`
- `folder`
- `uploadedAt`
- `server`
- `encryptionKey`
- optional `deleted`

## Practical Outcome
- Files indexed by NostrMesh can be interpreted by clients following the same conventions.
- Future integration effort stays low because event semantics are intentionally matched.
