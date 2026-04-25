#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

extract_ip() {
  local payload="$1"
  printf '%s' "${payload}" | grep -Eo '10\.44\.[0-9]{1,3}\.[0-9]{1,3}' | head -n1 || true
}

is_valid_ip() {
  local ip="$1"
  [[ "${ip}" =~ ^10\.44\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

from_env="${NVPN_TUNNEL_IP:-}"
if is_valid_ip "${from_env}"; then
  echo "${from_env}"
  exit 0
fi

if [[ -f "${ENV_FILE}" ]]; then
  file_ip="$(grep -E '^NVPN_TUNNEL_IP=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
  if is_valid_ip "${file_ip}"; then
    echo "${file_ip}"
    exit 0
  fi
fi

if command -v nvpn >/dev/null 2>&1; then
  status_json="$(nvpn status --json 2>/dev/null || true)"
  status_ip="$(extract_ip "${status_json}")"
  if is_valid_ip "${status_ip}"; then
    echo "${status_ip}"
    exit 0
  fi

  status_text="$(nvpn status 2>/dev/null || true)"
  status_ip="$(extract_ip "${status_text}")"
  if is_valid_ip "${status_ip}"; then
    echo "${status_ip}"
    exit 0
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-vpn'; then
    docker_status="$(docker exec nostrmesh-vpn sh -c 'nvpn status --json 2>/dev/null || nvpn status 2>/dev/null || true' 2>/dev/null || true)"
    docker_ip="$(extract_ip "${docker_status}")"
    if is_valid_ip "${docker_ip}"; then
      echo "${docker_ip}"
      exit 0
    fi

    docker_logs="$(docker logs nostrmesh-vpn 2>&1 || true)"
    docker_ip="$(extract_ip "${docker_logs}")"
    if is_valid_ip "${docker_ip}"; then
      echo "${docker_ip}"
      exit 0
    fi
  fi
fi

if command -v ip >/dev/null 2>&1; then
  for dev in wg0 tun0 nostrvpn0; do
    addr_text="$(ip -4 addr show dev "${dev}" 2>/dev/null || true)"
    addr_ip="$(extract_ip "${addr_text}")"
    if is_valid_ip "${addr_ip}"; then
      echo "${addr_ip}"
      exit 0
    fi
  done
fi
