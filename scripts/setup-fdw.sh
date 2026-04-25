#!/usr/bin/env bash
# Deterministic FDW setup script for Node A to Node B over nostr-vpn (10.44.0.0/16).
#
# Usage:
#   ./scripts/setup-fdw.sh <remote-tunnel-ip> <node-name> <from-ts> <to-ts>
#
# Example:
#   ./scripts/setup-fdw.sh 10.44.7.9 node_b 0 MAXVALUE

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/common.sh"

REMOTE_TUNNEL_IP="${1:?Usage: $0 <remote-tunnel-ip> <node-name> <from-ts> <to-ts>}"
NODE_NAME="${2:?node-name required}"
FROM_TS="${3:?from-timestamp required (e.g. 0)}"
TO_TS="${4:?to-timestamp required (e.g. MAXVALUE)}"

DB_USER="nostr_ts_relay"
DB_NAME="nostr_ts_relay"
DB_PASS="nostr_ts_relay"
DB_CONTAINER="nostrmesh-db"

log "Setting up FDW to ${NODE_NAME} at ${REMOTE_TUNNEL_IP}..."

if ! is_container_running "${DB_CONTAINER}"; then
  echo "ERROR: ${DB_CONTAINER} is not running. Start the stack first." >&2
  exit 1
fi

sql_from=$([ "${FROM_TS}" = "MINVALUE" ] && echo "MINVALUE" || echo "${FROM_TS}")
sql_to=$([ "${TO_TS}"   = "MAXVALUE" ] && echo "MAXVALUE" || echo "${TO_TS}")

log "Executing FDW registration in ${DB_CONTAINER}..."

docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" <<SQL
CREATE SERVER IF NOT EXISTS storage_${NODE_NAME}
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (
    host '${REMOTE_TUNNEL_IP}',
    port '5432',
    dbname '${DB_NAME}',
    async_capable 'true',
    fetch_size '1000'
  );

CREATE USER MAPPING IF NOT EXISTS FOR ${DB_USER}
  SERVER storage_${NODE_NAME}
  OPTIONS (user '${DB_USER}', password '${DB_PASS}');

CREATE FOREIGN TABLE IF NOT EXISTS events_archive_${NODE_NAME} (
  id                   uuid,
  event_id             bytea         NOT NULL,
  event_pubkey         bytea         NOT NULL,
  event_kind           integer       NOT NULL,
  event_created_at     integer       NOT NULL,
  event_content        text          NOT NULL,
  event_tags           jsonb,
  event_signature      bytea         NOT NULL,
  first_seen           timestamp,
  deleted_at           timestamp,
  remote_address       text,
  expires_at           integer,
  event_deduplication  jsonb
)
  SERVER storage_${NODE_NAME}
  OPTIONS (table_name 'events_data');

ALTER TABLE events
  ATTACH PARTITION events_archive_${NODE_NAME}
  FOR VALUES FROM (${sql_from}) TO (${sql_to});

SELECT 'Storage node ${NODE_NAME} at ${REMOTE_TUNNEL_IP} attached successfully over nostr-vpn.' AS result;
SQL

log "FDW setup complete."
