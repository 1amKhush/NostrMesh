#!/bin/sh
set -e

CONFIG=/etc/yggdrasil/yggdrasil.conf

if [ -z "$COORDINATOR_PEER" ]; then
  echo "[yggdrasil] ERROR: COORDINATOR_PEER is required."
  echo "[yggdrasil] Example: COORDINATOR_PEER=tcp://1.2.3.4:12345"
  exit 1
fi

if [ -z "$COORDINATOR_PUBLIC_KEY" ]; then
  echo "[yggdrasil] ERROR: COORDINATOR_PUBLIC_KEY is required."
  echo "[yggdrasil] Get this from the coordinator's startup log."
  exit 1
fi

get_self_payload() {
  yggdrasilctl -json getSelf 2>/dev/null || \
  yggdrasilctl -json getself 2>/dev/null || \
  yggdrasilctl getSelf 2>/dev/null || \
  yggdrasilctl getself 2>/dev/null || \
  true
}

extract_self_field() {
  payload="$1"
  field="$2"

  if [ -z "$payload" ]; then
    echo ""
    return
  fi

  value=$(echo "$payload" | jq -r ".self.${field} // .${field} // empty" 2>/dev/null || true)
  if [ -n "$value" ]; then
    echo "$value"
    return
  fi

  if [ "$field" = "address" ]; then
    echo "$payload" | tr '\r' '\n' | grep -Eo '2[0-9a-fA-F]{2}:[0-9a-fA-F:]+' | head -n1 || true
    return
  fi

  if [ "$field" = "key" ]; then
    echo "$payload" | tr '\r' '\n' | grep -Eo '[0-9a-fA-F]{64}' | head -n1 || true
    return
  fi

  echo ""
}

# Generate config on first run. Keys persist via bind-mounted volume.
if [ ! -f "$CONFIG" ]; then
  echo "[yggdrasil] Generating new storage node config..."
  yggdrasil -genconf > "$CONFIG"

  jq --arg peer "$COORDINATOR_PEER" \
     --arg key "$COORDINATOR_PUBLIC_KEY" \
     '.Peers = [$peer] | .AllowedPublicKeys = [$key]' \
     "$CONFIG" > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "$CONFIG"

  echo "[yggdrasil] Config written."
  echo "[yggdrasil] Peer        : ${COORDINATOR_PEER}"
  echo "[yggdrasil] Allowed key : ${COORDINATOR_PUBLIC_KEY}"
fi

yggdrasil -useconffile "$CONFIG" &
YGG_PID=$!

echo "[yggdrasil] Waiting for daemon..."
SELF=""
ADDR=""
for i in $(seq 1 30); do
  SELF=$(get_self_payload)
  ADDR=$(extract_self_field "$SELF" address)
  if [ -n "$ADDR" ]; then
    break
  fi
  sleep 1
done

if [ -z "$ADDR" ]; then
  ADDR="unknown"
fi

PUBKEY=$(extract_self_field "$SELF" key)
if [ -z "$PUBKEY" ]; then
  PUBKEY="unknown"
fi

echo ""
echo "============================================================"
echo " Yggdrasil Storage Node"
echo " Address   : ${ADDR}"
echo " Public key: ${PUBKEY}"
echo " Coordinator peer: ${COORDINATOR_PEER}"
echo "============================================================"
echo ""

wait $YGG_PID
