#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
ENV_FILE="${ROOT_DIR}/.env"

RELAY_HTTP_URL="${RELAY_HTTP_URL:-http://127.0.0.1:8008}"
BLOSSOM_HTTP_URL="${BLOSSOM_HTTP_URL:-http://127.0.0.1:3000}"
API_HTTP_URL="${API_HTTP_URL:-http://127.0.0.1:4000}"
RELAY_WS_URL="${RELAY_WS_URL:-ws://127.0.0.1:8008}"

log() {
  printf '[nostrmesh] %s\n' "$*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

require_docker_compose() {
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2+ is required (docker compose)." >&2
    exit 1
  fi
}

require_root_compose() {
  if [[ ! -f "${ROOT_COMPOSE_FILE}" ]]; then
    echo "Missing compose file: ${ROOT_COMPOSE_FILE}" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-60}"
  local header="${3:-}"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    if [[ -n "${header}" ]]; then
      if curl -fsS -H "${header}" "${url}" >/dev/null 2>&1; then
        return 0
      fi
    else
      if curl -fsS "${url}" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

read_env_value() {
  local key="$1"

  if [[ ! -f "${ENV_FILE}" ]]; then
    echo ""
    return
  fi

  grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true
}

is_container_running() {
  local container_name="$1"
  docker ps --format '{{.Names}}' | grep -qx "${container_name}"
}
