# Hostinger Static Web Setup

You can host the CipherNode web app on a normal Hostinger static/shared hosting plan. You do not need Hostinger's Node.js app package for the frontend.

The web app still needs a relay server for messaging. Run the Go relay somewhere else, for example a VPS, Docker host, Cloudflare Tunnel target, or another server:

```bash
docker run -d \
  --name ciphernode-relay \
  -p 5000:5000 \
  -e CORS_ALLOWED_ORIGINS=https://your-hostinger-domain.com \
  --restart unless-stopped \
  mero003/ciphernode:latest
```

Put HTTPS in front of the relay with Nginx, Caddy, Cloudflare Tunnel, or another reverse proxy. The final relay URL should look like:

```text
https://relay.your-domain.com
```

## Build The Static Site

PowerShell:

```powershell
$env:API_URL="https://relay.your-domain.com"
$env:WS_URL="wss://relay.your-domain.com/ws"
npm.cmd run web:hostinger
```

Bash:

```bash
API_URL=https://relay.your-domain.com WS_URL=wss://relay.your-domain.com/ws npm run web:hostinger
```

The output is created in:

```text
hostinger-web/
```

Upload the contents of `hostinger-web/` to Hostinger `public_html/`. Upload the contents of the folder, not the folder itself.

## Important

- `API_URL` must be the relay URL, not the Hostinger static site URL.
- `WS_URL` should point to the relay WebSocket endpoint, usually the same relay domain plus `/ws`.
- The relay must allow the Hostinger origin with `CORS_ALLOWED_ORIGINS`.
- The generated `.htaccess` handles single-page app fallback on Hostinger/Apache.
