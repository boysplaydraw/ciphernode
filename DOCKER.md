# CipherNode Docker Setup

The published image runs the Go relay server and serves the bundled Expo web app from one container.

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
curl -O https://raw.githubusercontent.com/boysplaydraw/ciphernode/master/.env.example
cp .env.example .env
docker compose up -d
```

Logs:

```bash
docker compose logs -f ciphernode-relay
```

Health check:

```bash
curl http://localhost:5000/api/health
```

## HTTPS

The container listens on HTTP port `5000`. Terminate HTTPS in a reverse proxy and proxy traffic to the container.

Example Nginx upstream target:

```nginx
proxy_pass http://127.0.0.1:5000;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto https;
```

## Environment

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Server port inside the container |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per-client relay rate limit |
| `MESSAGE_TTL` | `24h` | Pending message lifetime |
| `FILE_TTL` | `24h` | Shared file lifetime |
| `REPLAY_TTL` | `1h` | Replay nonce lifetime |
| `TIMESTAMP_SKEW` | `5m` | Accepted signed timestamp skew |
| `MAX_FILE_SIZE_MB` | `100` | Maximum encrypted file payload size |
| `MAX_FILE_DOWNLOADS` | `10` | Maximum downloads per shared file |
| `CORS_ALLOWED_ORIGINS` | empty | Optional comma-separated origin allowlist |
| `ONION_ADDRESS` | empty | Optional external Tor hidden service address |

## Build Locally

```bash
docker build -t ciphernode:go .
docker run --rm -p 5000:5000 ciphernode:go
```

The root `Dockerfile` uses Node only in the build stage to export the web app. The runtime process is `/app/ciphernode-server`, compiled from `server/go/cmd/ciphernode-server`.
