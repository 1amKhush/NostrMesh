#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

NOSTREAM_DIR="${ROOT_DIR}/nostream-share"
NOSTREAM_REPO_URL="${NOSTREAM_REPO_URL:-https://github.com/Fromstr/nostream-share.git}"

BLOSSOM_COMPOSE_FILE="${ROOT_DIR}/docker-compose.blossom.yml"

RELAY_HTTP_URL="${RELAY_HTTP_URL:-http://127.0.0.1:8008}"
BLOSSOM_HTTP_URL="${BLOSSOM_HTTP_URL:-http://127.0.0.1:3000}"
API_HTTP_URL="${API_HTTP_URL:-http://127.0.0.1:${API_PORT:-4000}}"
RELAY_PUBLIC_URL="${RELAY_PUBLIC_URL:-ws://localhost:8008}"
BLOSSOM_PUBLIC_URL="${BLOSSOM_PUBLIC_URL:-http://localhost:3000}"

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
  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    echo "Missing ${COMPOSE_FILE}" >&2
    exit 1
  fi
}

ensure_nostream_dir() {
  if [[ ! -d "${NOSTREAM_DIR}" ]]; then
    echo "nostream-share not found at ${NOSTREAM_DIR}" >&2
    exit 1
  fi

  local required_paths=(
    "Dockerfile"
    "migrations"
    "knexfile.js"
    "resources/default-settings.yaml"
  )

  local missing=0
  for rel in "${required_paths[@]}"; do
    if [[ ! -e "${NOSTREAM_DIR}/${rel}" ]]; then
      echo "nostream-share is missing required path: ${NOSTREAM_DIR}/${rel}" >&2
      missing=1
    fi
  done

  if (( missing != 0 )); then
    exit 1
  fi

  if [[ ! -x "${NOSTREAM_DIR}/scripts/start" ]]; then
    echo "nostream-share start script missing or not executable." >&2
    exit 1
  fi
}

ensure_nostream_settings() {
  local config_dir="${NOSTREAM_DIR}/.nostr"
  local settings_file="${config_dir}/settings.yaml"
  local default_settings_file="${NOSTREAM_DIR}/resources/default-settings.yaml"
  local tmp_file

  mkdir -p "${config_dir}"

  if [[ ! -f "${default_settings_file}" ]]; then
    echo "Missing default settings file: ${default_settings_file}" >&2
    exit 1
  fi

  if [[ ! -f "${settings_file}" ]]; then
    log "Creating relay settings at ${settings_file}"
    cp "${default_settings_file}" "${settings_file}"
  fi

  # Keep local smoke/development flow simple by disabling relay AUTH checks.
  tmp_file="$(mktemp)"
  awk '
    BEGIN { in_auth = 0; auth_seen = 0; enabled_set = 0 }
    /^authentication:[[:space:]]*$/ {
      in_auth = 1
      auth_seen = 1
      enabled_set = 0
      print
      next
    }
    in_auth && /^[^[:space:]]/ {
      if (!enabled_set) {
        print "  enabled: false"
      }
      in_auth = 0
    }
    in_auth && /^[[:space:]]*enabled:[[:space:]]*/ {
      print "  enabled: false"
      enabled_set = 1
      next
    }
    { print }
    END {
      if (in_auth && !enabled_set) {
        print "  enabled: false"
      }
      if (!auth_seen) {
        print ""
        print "authentication:"
        print "  enabled: false"
      }
    }
  ' "${settings_file}" > "${tmp_file}"
  mv "${tmp_file}" "${settings_file}"
}

ensure_nostream_checkout() {
  local sibling_nostream="${ROOT_DIR}/../nostream-share"

  if [[ -d "${NOSTREAM_DIR}" ]]; then
    return
  fi

  require_cmd git

  if [[ -f "${ROOT_DIR}/.gitmodules" ]]; then
    log "Initializing nostream-share submodule"
    (
      cd "${ROOT_DIR}"
      git submodule update --init --recursive nostream-share
    ) || true
  fi

  if [[ -d "${NOSTREAM_DIR}" ]]; then
    return
  fi

  if [[ -n "${NOSTREAM_REPO_URL}" ]]; then
    log "Cloning nostream-share from ${NOSTREAM_REPO_URL}"
    if git clone --depth=1 "${NOSTREAM_REPO_URL}" "${NOSTREAM_DIR}"; then
      return
    fi
    log "Remote clone failed. Attempting local fallback checkout."
  fi

  if [[ -d "${sibling_nostream}/.git" ]]; then
    log "Cloning local nostream-share sibling into ${NOSTREAM_DIR}"
    git clone --depth=1 "file://${sibling_nostream}" "${NOSTREAM_DIR}"
    return
  fi

  echo "Unable to bootstrap nostream-share. Set NOSTREAM_REPO_URL in ${ENV_FILE} or provide ${sibling_nostream}." >&2
  exit 1
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 128
  else
    head -c 128 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ensure_nostream_env() {
  local env_file="${NOSTREAM_DIR}/.env"

  if [[ ! -f "${env_file}" ]]; then
    log "Creating ${env_file}"
    cat > "${env_file}" <<EOF
SECRET=$(generate_secret)
YGGDRASIL_LISTEN_PORT=12345
ZEBEDEE_API_KEY=
NODELESS_API_KEY=
NODELESS_WEBHOOK_SECRET=
OPENNODE_API_KEY=
LNBITS_API_KEY=
EOF
    return
  fi

  if ! grep -Eq '^SECRET=.+$' "${env_file}"; then
    log "Adding SECRET to ${env_file}"
    echo "SECRET=$(generate_secret)" >> "${env_file}"
  fi

  if ! grep -Eq '^YGGDRASIL_LISTEN_PORT=' "${env_file}"; then
    echo 'YGGDRASIL_LISTEN_PORT=12345' >> "${env_file}"
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
