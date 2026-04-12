#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
DISCOVER_SCRIPT="${SCRIPT_DIR}/discover-mesh-address.sh"

generate_hex() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "${bytes}"
  else
    head -c "${bytes}" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

get_env_value() {
  local key="$1"
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo ""
    return
  fi
  grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true
}

upsert_env() {
  local key="$1"
  local value="$2"
  local tmp_file

  if [[ ! -f "${ENV_FILE}" ]]; then
    printf '%s=%s\n' "${key}" "${value}" > "${ENV_FILE}"
    return
  fi

  tmp_file="$(mktemp)"
  awk -v k="${key}" -v v="${value}" '
    BEGIN { updated = 0 }
    $0 ~ "^" k "=" {
      if (updated == 0) {
        print k "=" v
        updated = 1
      }
      next
    }
    { print }
    END {
      if (updated == 0) {
        print k "=" v
      }
    }
  ' "${ENV_FILE}" > "${tmp_file}"
  mv "${tmp_file}" "${ENV_FILE}"
}

remove_env_key() {
  local key="$1"
  local tmp_file

  if [[ ! -f "${ENV_FILE}" ]]; then
    return
  fi

  tmp_file="$(mktemp)"
  awk -v k="${key}" '$0 !~ "^" k "=" { print }' "${ENV_FILE}" > "${tmp_file}"
  mv "${tmp_file}" "${ENV_FILE}"
}

is_secret_hex() {
  local value="$1"
  [[ "${value}" =~ ^[a-fA-F0-9]{64}$ ]]
}

mkdir -p "${ROOT_DIR}"
touch "${ENV_FILE}"

secret="$(get_env_value SECRET)"
if [[ -z "${secret}" ]]; then
  secret="$(generate_hex 128)"
fi

nostr_secret="$(get_env_value NOSTR_SECRET_KEY)"
if ! is_secret_hex "${nostr_secret}"; then
  nostr_secret="$(generate_hex 32)"
fi

api_port="$(get_env_value API_PORT)"
if [[ -z "${api_port}" ]]; then
  api_port="4000"
fi

relay_url="$(get_env_value RELAY_URL)"
if [[ -z "${relay_url}" ]]; then
  relay_url="ws://nostrmesh-relay:8008"
fi

blossom_url="$(get_env_value BLOSSOM_URL)"
if [[ -z "${blossom_url}" ]]; then
  blossom_url="http://nostrmesh-blossom:3000"
fi

mesh_address=""
if [[ -x "${DISCOVER_SCRIPT}" ]]; then
  mesh_address="$("${DISCOVER_SCRIPT}" || true)"
fi

if [[ -n "${mesh_address}" ]]; then
  blossom_public_url="http://[${mesh_address}]:3000"
  relay_public_url="ws://[${mesh_address}]:8008"
else
  blossom_public_url="$(get_env_value BLOSSOM_PUBLIC_URL)"
  relay_public_url="$(get_env_value RELAY_PUBLIC_URL)"

  if [[ -z "${blossom_public_url}" ]]; then
    blossom_public_url="http://localhost:3000"
  fi
  if [[ -z "${relay_public_url}" ]]; then
    relay_public_url="ws://localhost:8008"
  fi
fi

yggdrasil_listen_port="$(get_env_value YGGDRASIL_LISTEN_PORT)"
if [[ -z "${yggdrasil_listen_port}" ]]; then
  yggdrasil_listen_port="12345"
fi

upsert_env SECRET "${secret}"
upsert_env NOSTR_SECRET_KEY "${nostr_secret}"
upsert_env API_PORT "${api_port}"
upsert_env RELAY_URL "${relay_url}"
upsert_env BLOSSOM_URL "${blossom_url}"
upsert_env BLOSSOM_PUBLIC_URL "${blossom_public_url}"
upsert_env RELAY_PUBLIC_URL "${relay_public_url}"
upsert_env YGGDRASIL_LISTEN_PORT "${yggdrasil_listen_port}"
remove_env_key NOSTREAM_BUILD_CONTEXT

echo "Initialized ${ENV_FILE}"
echo "- BLOSSOM_PUBLIC_URL=${blossom_public_url}"
echo "- RELAY_PUBLIC_URL=${relay_public_url}"
