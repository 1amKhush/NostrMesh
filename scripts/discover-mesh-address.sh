#!/usr/bin/env bash
set -euo pipefail

extract_address() {
  local payload="$1"
  local address=""

  if [[ -z "${payload}" ]]; then
    echo ""
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    address="$(printf '%s' "${payload}" | jq -r '.self.address // .address // empty' 2>/dev/null || true)"
  else
    address="$(
      printf '%s' "${payload}" \
        | tr -d '\r' \
        | grep -Eo '"address"[[:space:]]*:[[:space:]]*"[^"]+"' \
        | head -n1 \
        | cut -d'"' -f4 \
        || true
    )"
  fi

  if [[ -z "${address}" ]]; then
    address="$(printf '%s' "${payload}" | tr '\r' '\n' | grep -Eo '2[0-9a-fA-F]{2}:[0-9a-fA-F:]+' | head -n1 || true)"
  fi

  echo "${address}"
}

mesh_address=""

if command -v yggdrasilctl >/dev/null 2>&1; then
  raw_host="$(yggdrasilctl -json getSelf 2>/dev/null || yggdrasilctl -json getself 2>/dev/null || yggdrasilctl getSelf 2>/dev/null || yggdrasilctl getself 2>/dev/null || true)"
  mesh_address="$(extract_address "${raw_host}")"
fi

if [[ -z "${mesh_address}" ]] && command -v docker >/dev/null 2>&1; then
  for container_name in nostrmesh-yggdrasil nostream-yggdrasil; do
    if docker ps --format '{{.Names}}' | grep -qx "${container_name}"; then
      raw_docker="$(docker exec "${container_name}" sh -c 'yggdrasilctl -json getSelf 2>/dev/null || yggdrasilctl -json getself 2>/dev/null || yggdrasilctl getSelf 2>/dev/null || yggdrasilctl getself 2>/dev/null || true' 2>/dev/null || true)"
      mesh_address="$(extract_address "${raw_docker}")"
      if [[ -n "${mesh_address}" ]]; then
        break
      fi
    fi
  done
fi

if [[ -n "${mesh_address}" ]]; then
  echo "${mesh_address}"
fi
