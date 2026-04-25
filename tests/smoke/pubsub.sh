#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../scripts/common.sh"

require_cmd docker

if ! docker ps --format '{{.Names}}' | grep -qx 'nostrmesh-relay'; then
  echo "[pubsub] nostrmesh-relay container is not running. Start relay first with scripts/relay-up.sh" >&2
  exit 1
fi

echo "[pubsub] Running relay pub/sub smoke test via nostrmesh-relay container"

docker exec -i -w /app nostrmesh-relay node <<'NODE'
const crypto = require('crypto');
const WebSocket = require('ws');
const secp = require('@noble/secp256k1');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toHex(value) {
  return Buffer.from(value).toString('hex');
}

async function createSignedEvent() {
  return createEvent(1, `nostrmesh-smoke-${Date.now()}`, [['t', 'nostrmesh-smoke']]);
}

async function createEvent(kind, content, tags) {
  const sk = secp.utils.randomPrivateKey();
  const pubkey = toHex(secp.schnorr.getPublicKey(sk));
  const createdAt = Math.floor(Date.now() / 1000);
  const event = {
    kind,
    pubkey,
    created_at: createdAt,
    tags,
    content,
  };

  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  event.id = sha256Hex(serialized);
  event.sig = toHex(await secp.schnorr.sign(event.id, sk));
  return { event, sk, pubkey };
}

async function run() {
  const relayUrl = process.env.RELAY_WS_URL || 'ws://127.0.0.1:8008';
  const signed = await createSignedEvent();
  const event = signed.event;
  const sk = signed.sk;
  const pubkey = signed.pubkey;

  const ws = new WebSocket(relayUrl);
  const subId = `nostrmesh-smoke-${Date.now()}`;
  const retrySubId = `${subId}-retry`;
  let gotOk = false;
  let gotEvent = false;
  let eventSent = false;
  let authInProgress = false;

  const failTimer = setTimeout(() => {
    console.error('[pubsub] timeout waiting for publish/subscription confirmation');
    process.exit(1);
  }, 20000);

  function sendEvent() {
    if (eventSent) {
      return;
    }
    eventSent = true;
    ws.send(JSON.stringify(['EVENT', event]));
  }

  ws.on('open', () => {
    const filter = {
      kinds: [1],
      '#t': ['nostrmesh-smoke'],
      since: event.created_at - 5,
      limit: 5,
    };

    ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => {
      if (!authInProgress) {
        sendEvent();
      }
    }, 300);
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    const kind = msg[0];
    if (kind === 'OK' && msg[1] === event.id) {
      if (msg[2] === true) {
        gotOk = true;

        const retryFilter = {
          kinds: [1],
          '#t': ['nostrmesh-smoke'],
          ids: [event.id],
          limit: 1,
        };
        ws.send(JSON.stringify(['REQ', retrySubId, retryFilter]));
      } else {
        console.error('[pubsub] relay rejected event:', msg[3]);
        process.exit(1);
      }
    }

    if (kind === 'OK' && msg[2] === true && typeof msg[1] === 'string' && msg[1] !== event.id) {
      // likely AUTH ack for a different event id
      sendEvent();
    }

    if (kind === 'AUTH' && typeof msg[1] === 'string') {
      authInProgress = true;
      const challenge = msg[1];
      const auth = await createEvent(22242, '', [
        ['relay', relayUrl],
        ['challenge', challenge],
      ]);
      // reuse the same pubkey for identity continuity when possible
      auth.event.pubkey = pubkey;
      const serialized = JSON.stringify([
        0,
        auth.event.pubkey,
        auth.event.created_at,
        auth.event.kind,
        auth.event.tags,
        auth.event.content,
      ]);
      auth.event.id = sha256Hex(serialized);
      auth.event.sig = toHex(await secp.schnorr.sign(auth.event.id, sk));

      ws.send(JSON.stringify(['AUTH', auth.event]));
      setTimeout(() => {
        authInProgress = false;
        sendEvent();
      }, 200);
    }

    if (kind === 'EVENT' && (msg[1] === subId || msg[1] === retrySubId) && msg[2] && msg[2].id === event.id) {
      gotEvent = true;
    }

    if (kind === 'NOTICE') {
      console.log('[pubsub] relay notice:', msg[1]);
    }

    if (gotOk && gotEvent) {
      clearTimeout(failTimer);
      ws.send(JSON.stringify(['CLOSE', subId]));
      ws.close();
      console.log('[pubsub] PASS');
      process.exit(0);
    }
  });

  ws.on('error', (err) => {
    clearTimeout(failTimer);
    console.error('[pubsub] websocket error:', err.message);
    process.exit(1);
  });
}

run().catch((error) => {
  console.error('[pubsub] fatal error:', error);
  process.exit(1);
});
NODE
