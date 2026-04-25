# NostrMesh Dependencies

## External Project Pins

| Dependency | Pin | Source |
| --- | --- | --- |
| nostream-share | `88edd722833075b05a469b6437d9f78a256334b8` | sibling repository `../nostream-share` |

Update this pin intentionally when consuming relay behavior changes.

## Runtime Requirements

| Component | Version / Constraint | Notes |
| --- | --- | --- |
| Docker Engine | 29.x tested locally | Required for relay + blossom containers |
| Docker Compose | v5.x tested locally | Used by stack scripts |
| jq | 1.7 tested locally | Used by health and helper scripts |
| Node.js | 18.x baseline | Matches nostream-share and API/blossom services |

## Infrastructure Versions

| Service | Version | Where pinned |
| --- | --- | --- |
| nostr-vpn | latest | `ghcr.io/mmalmi/nostr-vpn:latest` |
| PostgreSQL | `postgres` image tag (floating) | `../nostream-share/docker-compose.yml` |
| Redis | `7.0.5-alpine3.16` | `../nostream-share/docker-compose.yml` |
| Relay (nostream) | v2.1.0 package version | `../nostream-share/package.json` |

## Environment Inputs

### Relay (nostream-share)
- Required:
  - `SECRET` (long random hex string)
- Optional:
  - Payment provider keys (`ZEBEDEE_API_KEY`, `NODELESS_API_KEY`, `NODELESS_WEBHOOK_SECRET`, `OPENNODE_API_KEY`, `LNBITS_API_KEY`)

`scripts/relay-up.sh` in this repo auto-creates a `.env` in `../nostream-share` if missing.

### NostrMesh API (planned)
- `API_PORT` (default `4000`)
- `RELAY_URLS` (comma-separated)
- `BLOSSOM_URL` (default `http://localhost:3000`)
- `NOSTR_SECRET_KEY` (hex secret, generated on first start if missing)

### Blossom-compatible server (local)
- `BLOSSOM_CONFIG` path
- Storage path and upload limits from config file

## Compatibility Notes
- Metadata conventions intentionally match formstr-drive for future interoperability.
- Kind `34578` replaceable events are used instead of kind `1063` to support metadata updates and soft deletes.
