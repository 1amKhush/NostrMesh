#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_docker_compose

if [[ ! -f "${BLOSSOM_COMPOSE_FILE}" ]]; then
  echo "Missing ${BLOSSOM_COMPOSE_FILE}" >&2
  exit 1
fi

log "Stopping local Blossom service"
docker compose -f "${BLOSSOM_COMPOSE_FILE}" down "$@"
