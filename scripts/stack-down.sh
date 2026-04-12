#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_docker_compose
require_root_compose

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" down "$@"

echo "NostrMesh stack stopped"
