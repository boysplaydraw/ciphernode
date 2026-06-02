# CipherNode

End-to-end encrypted messaging relay with bundled web client. The published Docker image runs the Go relay server and serves the Expo web app from the same container.

## Quick Start

```bash
docker run -d \
  --name ciphernode \
  -p 5000:5000 \
  --restart unless-stopped \
  mero003/ciphernode:latest
```

Open:

```text
http://server-ip:5000/app
```

## Docker Compose

```bash
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/docker-compose.yml
docker compose up -d
```

## HTTPS

The Go container listens on HTTP port `5000`. For HTTPS, terminate TLS in a reverse proxy such as Caddy, Nginx, Cloudflare Tunnel, or your platform load balancer, then proxy to `http://ciphernode-relay:5000`.

## Environment

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Server port inside the container |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per-client relay rate limit |
| `MESSAGE_TTL` | `24h` | Pending message lifetime |
| `FILE_TTL` | `24h` | Shared file lifetime |
| `MAX_FILE_SIZE_MB` | `100` | Maximum encrypted file payload size |
| `MAX_FILE_DOWNLOADS` | `10` | Maximum downloads per shared file |
| `CORS_ALLOWED_ORIGINS` | empty | Optional comma-separated origin allowlist |
| `ONION_ADDRESS` | empty | Optional external Tor hidden service address |

## Legal

- Privacy Policy: https://cipher-node.site/privacy
- Terms of Service: https://cipher-node.site/terms
- License: GPLv3
