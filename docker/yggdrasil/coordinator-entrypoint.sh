#!/bin/sh
set -e

CONFIG=/etc/yggdrasil/yggdrasil.conf
NODES_FILE=/etc/yggdrasil/nodes.json

# Generate config on first run. Keys persist via bind-mounted volume.
if [ ! -f "$CONFIG" ]; then
  echo "[yggdrasil] Generating new coordinator config..."
  yggdrasil -genconf > "$CONFIG"

  LISTEN_PORT="${YGGDRASIL_LISTEN_PORT:-12345}"
  jq --arg port "$LISTEN_PORT" \
    '.Listen = ["tcp://0.0.0.0:\($port)"]' \
    "$CONFIG" > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "$CONFIG"

  echo "[yggdrasil] Config written. Listen port: ${LISTEN_PORT}"
fi

if [ ! -f "$NODES_FILE" ]; then
  echo '{}' > "$NODES_FILE"
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
echo " Yggdrasil Coordinator"
echo " Address   : ${ADDR}"
echo " Public key: ${PUBKEY}"
echo " Peer addr : tcp://YOUR_PUBLIC_IP:${YGGDRASIL_LISTEN_PORT:-12345}"
echo ""
echo " Share the public key + peer address with storage operators."
echo " They need both to configure COORDINATOR_PUBLIC_KEY and"
echo " COORDINATOR_PEER in their .env file."
echo ""
echo "============================================================"
echo ""

wait $YGG_PID
