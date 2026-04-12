#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_docker_compose
require_root_compose

overall=0

print_row() {
  local name="$1"
  local status="$2"
  local detail="$3"
  printf '%-22s %-8s %s\n' "${name}" "${status}" "${detail}"
}

check_http() {
  local name="$1"
  local url="$2"
  local header="${3:-}"
  if [[ -n "${header}" ]]; then
    if curl -fsS -H "${header}" "${url}" >/dev/null 2>&1; then
      print_row "${name}" "OK" "${url}"
    else
      print_row "${name}" "FAIL" "${url}"
      overall=1
    fi
  else
    if curl -fsS "${url}" >/dev/null 2>&1; then
      print_row "${name}" "OK" "${url}"
    else
      print_row "${name}" "FAIL" "${url}"
      overall=1
    fi
  fi
}

check_container() {
  local name="$1"
  if docker ps --format '{{.Names}}' | grep -qx "${name}"; then
    local status
    status="$(docker ps --filter "name=^${name}$" --format '{{.Status}}' | head -n1)"
    print_row "container:${name}" "OK" "${status}"
  else
    print_row "container:${name}" "FAIL" "not running"
    overall=1
  fi
}

echo "NostrMesh health report"
echo "----------------------"
check_http "relay-http" "${RELAY_HTTP_URL}" 'Accept: application/nostr+json'
check_http "blossom-http" "${BLOSSOM_HTTP_URL}/health"
check_http "api-http" "${API_HTTP_URL}/health"

check_container "nostrmesh-relay"
check_container "nostrmesh-db"
check_container "nostrmesh-cache"
check_container "nostrmesh-blossom"
check_container "nostrmesh-api"

if docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-yggdrasil'; then
  check_container "nostrmesh-yggdrasil"
else
  if [[ "${NOSTRMESH_ALLOW_NO_YGGDRASIL:-0}" == "1" ]]; then
    print_row "container:nostrmesh-yggdrasil" "WARN" "not running (fallback mode)"
  else
    print_row "container:nostrmesh-yggdrasil" "FAIL" "not running"
    overall=1
  fi
fi

if docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-db'; then
  if docker exec nostrmesh-db pg_isready -U nostr_ts_relay >/dev/null 2>&1; then
    print_row "postgres" "OK" "pg_isready passed"
  else
    print_row "postgres" "FAIL" "pg_isready failed"
    overall=1
  fi
fi

if docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-cache'; then
  if docker exec nostrmesh-cache redis-cli -a nostr_ts_relay ping 2>/dev/null | grep -q PONG; then
    print_row "redis" "OK" "PING/PONG"
  else
    print_row "redis" "FAIL" "redis ping failed"
    overall=1
  fi
fi

ygg_addr="$("${SCRIPT_DIR}/discover-mesh-address.sh" || true)"
if docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-yggdrasil' && [[ -n "${ygg_addr}" ]]; then
  print_row "yggdrasil" "OK" "${ygg_addr}"
  check_http "relay-mesh-http" "http://[${ygg_addr}]:8008" 'Accept: application/nostr+json'
  check_http "blossom-mesh" "http://[${ygg_addr}]:3000/health"
elif [[ "${NOSTRMESH_ALLOW_NO_YGGDRASIL:-0}" == "1" ]]; then
  print_row "yggdrasil" "WARN" "not running (fallback mode)"
else
  print_row "yggdrasil" "FAIL" "address not found in logs"
  overall=1
fi

exit "${overall}"
