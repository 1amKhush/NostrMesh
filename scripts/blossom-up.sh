#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_docker_compose
require_root_compose

"${SCRIPT_DIR}/init-env.sh"

log "Starting Blossom service"
docker compose -f "${ROOT_COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build "$@" nvpn blossom

log "Waiting for Blossom health endpoint at ${BLOSSOM_HTTP_URL}/health"
if ! wait_for_http "${BLOSSOM_HTTP_URL}/health" 90; then
  echo "Blossom service did not become healthy in time." >&2
  docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'nostrmesh-blossom|NAMES' || true
  exit 1
fi

log "Blossom is healthy at ${BLOSSOM_HTTP_URL}"
