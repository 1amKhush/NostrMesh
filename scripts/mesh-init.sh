#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

CONFIG_DIR="${ROOT_DIR}/nvpn-config"
CONFIG_FILE="${CONFIG_DIR}/config.toml"
PARTICIPANT_NPUB=""
NETWORK_ID="${NOSTRMESH_NETWORK_ID:-nostrmesh-dev}"
RUN_INIT=0
PRINT_INVITE=0

usage() {
  cat <<'EOF'
Usage: scripts/mesh-init.sh [options]

Options:
  --participant <npub>   Set participant_npub in nvpn config
  --network-id <id>      Set network_id in nvpn config (default: nostrmesh-dev)
  --run-init             Run `nvpn init` after writing config (if nvpn is installed)
  --invite               Print an invite using `nvpn invite` (requires --run-init or prior init)
  -h, --help             Show this help
EOF
}

upsert_toml_value() {
  local key="$1"
  local value="$2"
  local tmp_file

  tmp_file="$(mktemp)"
  awk -v k="${key}" -v v="${value}" '
    BEGIN { updated = 0 }
    $0 ~ "^" k "[[:space:]]*=" {
      print k " = \"" v "\""
      updated = 1
      next
    }
    { print }
    END {
      if (updated == 0) {
        print k " = \"" v "\""
      }
    }
  ' "${CONFIG_FILE}" > "${tmp_file}"
  mv "${tmp_file}" "${CONFIG_FILE}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --participant)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --participant" >&2
        exit 1
      fi
      PARTICIPANT_NPUB="$2"
      shift 2
      ;;
    --network-id)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --network-id" >&2
        exit 1
      fi
      NETWORK_ID="$2"
      shift 2
      ;;
    --run-init)
      RUN_INIT=1
      shift
      ;;
    --invite)
      PRINT_INVITE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

"${SCRIPT_DIR}/init-env.sh" >/dev/null

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing config file after init: ${CONFIG_FILE}" >&2
  exit 1
fi

upsert_toml_value "network_id" "${NETWORK_ID}"
if [[ -n "${PARTICIPANT_NPUB}" ]]; then
  upsert_toml_value "participant_npub" "${PARTICIPANT_NPUB}"
fi

echo "Updated nostr-vpn config: ${CONFIG_FILE}"

if [[ ${RUN_INIT} -eq 1 ]]; then
  if ! command -v nvpn >/dev/null 2>&1; then
    echo "nvpn binary not found. Install nostr-vpn CLI and rerun with --run-init." >&2
    exit 1
  fi

  init_cmd=(nvpn init --config "${CONFIG_FILE}")
  if [[ -n "${PARTICIPANT_NPUB}" ]]; then
    init_cmd+=(--participant "${PARTICIPANT_NPUB}")
  fi

  echo "Running: ${init_cmd[*]}"
  "${init_cmd[@]}"
fi

if [[ ${PRINT_INVITE} -eq 1 ]]; then
  if ! command -v nvpn >/dev/null 2>&1; then
    echo "nvpn binary not found. Cannot generate invite." >&2
    exit 1
  fi

  echo "Generating invite"
  nvpn invite --config "${CONFIG_FILE}"
fi

echo "Next steps:"
echo "1. Start stack with ./scripts/stack-up.sh"
echo "2. Verify tunnel assignment with ./scripts/discover-tunnel-ip.sh"
