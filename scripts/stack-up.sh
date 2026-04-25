#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_docker_compose
require_root_compose

"${SCRIPT_DIR}/init-env.sh"

log "Starting NostrMesh stack (nostr-vpn + relay + blossom + api)"
docker compose -f "${ROOT_COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build "$@"

# Refresh public URLs after nvpn starts and can report the tunnel IP.
"${SCRIPT_DIR}/init-env.sh" >/dev/null || true

"${SCRIPT_DIR}/health-check.sh"

relay_public_url="$(read_env_value RELAY_PUBLIC_URL)"
blossom_public_url="$(read_env_value BLOSSOM_PUBLIC_URL)"

echo
echo "NostrMesh stack ready:"
echo "- Relay (local)   : ${RELAY_WS_URL}"
echo "- Blossom (local) : ${BLOSSOM_HTTP_URL}"
echo "- API (local)     : ${API_HTTP_URL}"
if [[ -n "${relay_public_url}" ]]; then
	echo "- Relay (mesh)    : ${relay_public_url}"
fi
if [[ -n "${blossom_public_url}" ]]; then
	echo "- Blossom (mesh)  : ${blossom_public_url}"
fi
