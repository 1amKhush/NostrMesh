# External Repository Issues (Deferred)

This file tracks issues encountered in repositories other than NostrMesh during implementation and validation.

## Scope

- Project owner: NostrMesh (local project)
- External repos in this workspace are Fromstr-maintained and should be addressed upstream.

## Issue 1: REQ query can fail with ambiguous event_id

- Repository: nostream-share
- Status: Open (deferred for maintainer)
- Severity: Medium
- Symptom:
  - Relay logs include: `web-socket-adapter: unable to handle message: error: column reference "event_id" is ambiguous`
- Observed impact:
  - Some publish/subscribe retrieval paths can fail or timeout when tag-based query logic is involved.
  - Publish acknowledgement may still succeed.
- Suspected root cause:
  - IDs filtering uses unqualified `event_id` while tag query path joins `event_tags`.
- References:
  - `nostream-share/src/repositories/event-repository.ts` (IDs mapping to `event_id`)
  - `nostream-share/src/repositories/event-repository.ts` (join with `event_tags`)
  - `nostream-share/src/adapters/web-socket-adapter.ts` (error surfaced in message handling)
- Suggested upstream action:
  - Fully qualify event table columns in query builder (e.g., `events.event_id`) where joins are present.
  - Add regression test for combined IDs + tag filters.

## Issue 2: Partition migration index-name collision

- Repository: nostream-share
- Status: Mitigated locally, should be fixed upstream
- Severity: Medium
- Symptom:
  - Migration can fail with `relation "replaceable_events_idx" already exists`.
- Observed impact:
  - Startup/migrate stage fails in clean bootstrap under certain schema states.
- References:
  - `nostream-share/migrations/20240120_000000_partition_events_table.js`
- Suggested upstream action:
  - Make migration idempotent around index naming or rename partition-era index to avoid global-name collisions.

## Issue 3: Replaceable event upsert conflicts with missing ON CONFLICT arbiter

- Repository: nostream-share
- Status: Open (deferred for maintainer)
- Severity: High
- Symptom:
  - Relay logs show write failure for kind 34578 publish path:
    - `there is no unique or exclusion constraint matching the ON CONFLICT specification`
  - API and mesh-test metadata publish can fail with `All promises were rejected`.
- Observed impact:
  - Replaceable metadata events (kind 34578) are not reliably acknowledged by relay.
  - End-to-end metadata publish/fetch flow is blocked by upstream constraint mismatch.
- References:
  - `nostream-share/src/repositories/event-repository.ts` (upsert ON CONFLICT expression)
  - `nostream-share/migrations/20240120_000000_partition_events_table.js` (partition/index setup)
- Suggested upstream action:
  - Ensure the ON CONFLICT target used by replaceable upserts maps to an existing unique/exclusion constraint in the partitioned schema.
  - Add migration/SQL regression coverage for kind 34578 upserts after partition migration.

## Cross-reference

- Draft maintainer summary prepared in:
  - `docs/nostream-share-maintainer-issue-draft.md`
