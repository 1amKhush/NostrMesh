#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_docker_compose
require_root_compose
ensure_nostream_checkout
ensure_nostream_dir
ensure_nostream_settings

"${SCRIPT_DIR}/init-env.sh"

if [[ -f "${ENV_FILE}" ]]; then
	set -a
	# shellcheck source=/dev/null
	source "${ENV_FILE}"
	set +a
fi

log "Starting NostrMesh compose stack"
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up --build -d "$@"

mesh_address=""
if [[ -x "${SCRIPT_DIR}/discover-mesh-address.sh" ]]; then
	for _ in {1..30}; do
		mesh_address="$("${SCRIPT_DIR}/discover-mesh-address.sh" || true)"
		if [[ -n "${mesh_address}" ]]; then
			break
		fi
		sleep 1
	done
fi

if [[ -n "${mesh_address}" ]]; then
	log "Mesh address discovered: ${mesh_address}; refreshing public URL env"
	"${SCRIPT_DIR}/init-env.sh" >/dev/null

	if [[ -f "${ENV_FILE}" ]]; then
		set -a
		# shellcheck source=/dev/null
		source "${ENV_FILE}"
		set +a
	fi

	log "Applying updated BLOSSOM_PUBLIC_URL and RELAY_PUBLIC_URL to running services"
	docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d blossom api

	# Services are briefly recreated after public URL updates.
	wait_for_http "${BLOSSOM_HTTP_URL}/health" 60 || true
	wait_for_http "${API_HTTP_URL}/health" 60 || true
fi

log "Running health checks"
"${SCRIPT_DIR}/health-check.sh"

echo
echo "NostrMesh stack ready:"
echo "- API     : http://localhost:${API_PORT:-4000}"
echo "- Relay   : ws://localhost:8008"
echo "- Blossom : http://localhost:3000"
echo "- Relay public   : ${RELAY_PUBLIC_URL:-ws://localhost:8008}"
echo "- Blossom public : ${BLOSSOM_PUBLIC_URL:-http://localhost:3000}"

if [[ -n "${mesh_address}" ]]; then
  echo "- Relay mesh   : ws://[${mesh_address}]:8008"
  echo "- Blossom mesh : http://[${mesh_address}]:3000"
else
  echo "- Mesh address: not detected yet"
fi
