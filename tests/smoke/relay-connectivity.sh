#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../scripts/common.sh"

require_cmd curl
require_cmd jq
require_cmd docker

echo "[relay-connectivity] Checking relay NIP-11 endpoint"
relay_json="$(curl -fsS -H 'Accept: application/nostr+json' "${RELAY_HTTP_URL}")"
relay_name="$(echo "${relay_json}" | jq -r '.name // empty')"

if [[ -z "${relay_name}" ]]; then
  echo "[relay-connectivity] Relay response does not contain a name field" >&2
  exit 1
fi

echo "[relay-connectivity] Relay name: ${relay_name}"

if docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-yggdrasil'; then
  ygg_address="$(docker logs nostrmesh-yggdrasil 2>&1 | awk -F': ' '/Address/{print $2}' | tail -n1 || true)"
  if [[ -z "${ygg_address}" ]]; then
    echo "[relay-connectivity] Could not determine Yggdrasil address from logs" >&2
    exit 1
  fi
  echo "[relay-connectivity] Yggdrasil address: ${ygg_address}"
else
  echo "[relay-connectivity] WARN: nostrmesh-yggdrasil container not running (fallback mode)"
fi

echo "[relay-connectivity] PASS"
