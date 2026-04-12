#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_docker_compose

if [[ ! -f "${BLOSSOM_COMPOSE_FILE}" ]]; then
  echo "Missing ${BLOSSOM_COMPOSE_FILE}" >&2
  exit 1
fi

if ! docker network inspect nostream >/dev/null 2>&1; then
  log "Creating shared docker network: nostream"
  docker network create nostream >/dev/null
fi

log "Starting local Blossom service"
docker compose -f "${BLOSSOM_COMPOSE_FILE}" up -d --build "$@"

log "Waiting for Blossom health endpoint at ${BLOSSOM_HTTP_URL}/health"
if ! wait_for_http "${BLOSSOM_HTTP_URL}/health" 90; then
  echo "Blossom service did not become healthy in time." >&2
  docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'nostrmesh-blossom|NAMES' || true
  exit 1
fi

log "Blossom is healthy at ${BLOSSOM_HTTP_URL}"
