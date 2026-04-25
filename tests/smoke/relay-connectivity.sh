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

if docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-vpn'; then
  tunnel_ip="$(${SCRIPT_DIR}/../../scripts/discover-tunnel-ip.sh || true)"
  if [[ -z "${tunnel_ip}" ]]; then
    echo "[relay-connectivity] Could not determine nostr-vpn tunnel IP" >&2
    exit 1
  fi
  echo "[relay-connectivity] Tunnel IP: ${tunnel_ip}"
else
  echo "[relay-connectivity] WARN: nostrmesh-vpn container not running"
fi

echo "[relay-connectivity] PASS"
