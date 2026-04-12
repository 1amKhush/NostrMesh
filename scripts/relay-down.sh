#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_docker_compose
ensure_nostream_checkout
ensure_nostream_dir

log "Stopping nostream-share relay stack"
pushd "${NOSTREAM_DIR}" >/dev/null
./scripts/stop "$@"
popd >/dev/null

log "Relay stack stopped"
