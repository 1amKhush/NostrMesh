#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_docker_compose
require_root_compose

log "Stopping local Blossom service"
docker compose -f "${ROOT_COMPOSE_FILE}" --env-file "${ENV_FILE}" stop "$@" blossom
