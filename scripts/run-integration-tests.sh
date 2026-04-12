#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ ! -x "${ROOT_DIR}/api/node_modules/.bin/tsx" ]]; then
  echo "[integration] Missing tsx runner at api/node_modules/.bin/tsx" >&2
  echo "[integration] Run npm install in api/ first" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-api'; then
  echo "[integration] Stack not running. Start with scripts/stack-up.sh" >&2
  exit 1
fi

echo "[integration] Running metadata roundtrip test"
"${ROOT_DIR}/api/node_modules/.bin/tsx" "${ROOT_DIR}/tests/integration/metadata-roundtrip.test.ts"

echo "[integration] Running e2e flow test"
"${ROOT_DIR}/api/node_modules/.bin/tsx" "${ROOT_DIR}/tests/integration/e2e-flow.test.ts"

echo "[integration] PASS"
