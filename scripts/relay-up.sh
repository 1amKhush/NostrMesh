#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_docker_compose
require_root_compose

"${SCRIPT_DIR}/init-env.sh"

log "Starting relay stack services"
docker compose -f "${ROOT_COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build \
  "$@" nvpn db cache migrate relay

log "Waiting for relay endpoint at ${RELAY_HTTP_URL}"
if ! wait_for_http "${RELAY_HTTP_URL}" 180 'Accept: application/nostr+json'; then
  echo "Relay did not become healthy in time." >&2
  docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'nostrmesh|NAMES' || true
  exit 1
fi

log "Relay is healthy."
log "Relay URL: ${RELAY_WS_URL}"
