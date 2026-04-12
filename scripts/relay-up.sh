#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_cmd jq
require_docker_compose
ensure_nostream_checkout
ensure_nostream_dir
ensure_nostream_settings
ensure_nostream_env

log "Starting nostream-share relay stack from ${NOSTREAM_DIR}"
pushd "${NOSTREAM_DIR}" >/dev/null
set +e
./scripts/start -d "$@"
start_status=$?
set -e

if [[ ${start_status} -ne 0 ]]; then
  if [[ "${NOSTRMESH_ALLOW_NO_YGGDRASIL:-1}" == "1" ]]; then
    log "Full startup failed. Falling back to relay-only mode (without Yggdrasil)."
    set +e
    docker compose \
      -f docker-compose.yml \
      up --build --remove-orphans -d \
      nostream-db nostream-cache nostream-migrate nostream
    fallback_status=$?
    set -e

    if [[ ${fallback_status} -ne 0 ]]; then
      log "Fallback compose returned non-zero. Attempting relay start without dependency checks."
      docker compose -f docker-compose.yml up -d --no-deps nostream
    fi
  else
    popd >/dev/null
    echo "nostream-share startup failed and fallback is disabled." >&2
    exit "${start_status}"
  fi
fi
popd >/dev/null

log "Waiting for relay endpoint at ${RELAY_HTTP_URL}"
if ! wait_for_http "${RELAY_HTTP_URL}" 180 'Accept: application/nostr+json'; then
  echo "Relay did not become healthy in time." >&2
  docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'nostream|NAMES' || true
  exit 1
fi

log "Relay is healthy."

if docker ps --format '{{.Names}}' | grep -qx 'nostream-yggdrasil'; then
  log "Yggdrasil identity snapshot:"
  docker logs --tail 120 nostream-yggdrasil 2>&1 | grep -E 'Yggdrasil Coordinator|Address|Public key|Peer addr' || true
else
  log "Yggdrasil container is not running (relay-only fallback mode)."
fi

log "Relay URL: ws://localhost:8008"
