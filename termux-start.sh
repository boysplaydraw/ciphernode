#!/data/data/com.termux/files/usr/bin/bash
set -e

MODE="${1:-server}"
PORT="${PORT:-5000}"
APP_DIR="${APP_DIR:-$PWD}"

echo "[CipherNode] Termux rootless runtime"

if [ "$(id -u)" = "0" ]; then
  echo "[CipherNode] Root kullanmayin. Termux normal kullanici ile calismali."
  exit 1
fi

ensure_pkg() {
  if ! command -v "$1" >/dev/null 2>&1; then
    pkg install -y "$2"
  fi
}

ensure_pkg node nodejs
ensure_pkg npm nodejs
ensure_pkg openssl openssl
ensure_pkg curl curl

cd "$APP_DIR"

if [ -f package.runtime.json ] && [ ! -f package.json ]; then
  cp package.runtime.json package.json
fi

if [ ! -d node_modules ]; then
  echo "[CipherNode] Runtime bagimliliklari kuruluyor..."
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
fi

if [ ! -f server_dist/index.mjs ]; then
  echo "[CipherNode] server_dist/index.mjs bulunamadi."
  echo "Kaynak repodaysaniz once: npm ci --ignore-scripts && npm run server:build"
  echo "Onerilen: scripts/build-termux-package.ps1 ile uretilen ciphernode-termux paketini kullanin."
  exit 1
fi

export NODE_ENV=production
export HTTPS=false
export HOST="${HOST:-0.0.0.0}"
export PORT="$PORT"

LOCAL_IP="$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || echo '')"

run_server_background() {
  HOST=127.0.0.1 node server_dist/index.mjs &
  SERVER_PID=$!
  sleep 2
}

start_server() {
  echo ""
  echo "=========================================="
  echo " CipherNode Termux"
  echo "=========================================="
  echo " Local : http://localhost:$PORT"
  [ -n "$LOCAL_IP" ] && echo " LAN   : http://$LOCAL_IP:$PORT"
  echo " Web   : http://localhost:$PORT/app"
  echo " HTTPS : bash termux-start.sh cloudflare"
  echo " Root  : gerekmez; 80/443 yerine $PORT kullanilir"
  echo "=========================================="
  echo ""
  exec node server_dist/index.mjs
}

case "$MODE" in
  server)
    start_server
    ;;

  cloudflare|cloudflared|https|tunnel)
    if ! command -v cloudflared >/dev/null 2>&1; then
      echo "[cloudflared] Kurulum deneniyor..."
      pkg install -y cloudflared || true
    fi

    if ! command -v cloudflared >/dev/null 2>&1; then
      ARCH="$(uname -m)"
      case "$ARCH" in
        aarch64) CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
        armv7l|armv8l) CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm" ;;
        x86_64) CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
        *) echo "Desteklenmeyen mimari: $ARCH"; exit 1 ;;
      esac
      curl -L "$CF_URL" -o "$PREFIX/bin/cloudflared"
      chmod +x "$PREFIX/bin/cloudflared"
    fi

    run_server_background

    LOG_FILE="$HOME/.ciphernode-cloudflared.log"
    rm -f "$LOG_FILE"
    echo "[cloudflared] HTTPS tunnel aciliyor..."
    cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate >"$LOG_FILE" 2>&1 &
    TUNNEL_PID=$!

    CF_PUBLIC_URL=""
    for _ in $(seq 1 45); do
      CF_PUBLIC_URL="$(grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | head -1 || true)"
      [ -n "$CF_PUBLIC_URL" ] && break
      sleep 1
    done

    echo ""
    echo "=========================================="
    echo " CipherNode Termux + Cloudflare HTTPS"
    echo "=========================================="
    [ -n "$CF_PUBLIC_URL" ] && echo " HTTPS : $CF_PUBLIC_URL/app" || echo " HTTPS : henuz bulunamadi; log: $LOG_FILE"
    echo " Local : http://localhost:$PORT/app"
    echo "=========================================="
    echo ""

    trap 'kill "$SERVER_PID" "$TUNNEL_PID" 2>/dev/null || true; exit 0' INT TERM
    wait "$TUNNEL_PID"
    ;;

  localtunnel|lt)
    ensure_pkg npx nodejs
    run_server_background

    LOG_FILE="$HOME/.ciphernode-localtunnel.log"
    rm -f "$LOG_FILE"
    echo "[localtunnel] HTTPS tunnel aciliyor..."
    npx --yes localtunnel --port "$PORT" --local-host 127.0.0.1 >"$LOG_FILE" 2>&1 &
    TUNNEL_PID=$!

    LT_PUBLIC_URL=""
    for _ in $(seq 1 45); do
      LT_PUBLIC_URL="$(grep -o 'https://[a-zA-Z0-9.-]*\.loca\.lt' "$LOG_FILE" 2>/dev/null | head -1 || true)"
      [ -n "$LT_PUBLIC_URL" ] && break
      sleep 1
    done

    echo ""
    echo "=========================================="
    echo " CipherNode Termux + LocalTunnel HTTPS"
    echo "=========================================="
    [ -n "$LT_PUBLIC_URL" ] && echo " HTTPS : $LT_PUBLIC_URL/app" || echo " HTTPS : henuz bulunamadi; log: $LOG_FILE"
    echo " Local : http://localhost:$PORT/app"
    echo "=========================================="
    echo ""

    trap 'kill "$SERVER_PID" "$TUNNEL_PID" 2>/dev/null || true; exit 0' INT TERM
    wait "$TUNNEL_PID"
    ;;

  tor)
    ensure_pkg tor tor

    TOR_BASE="$HOME/.ciphernode/tor"
    TOR_DATA="$TOR_BASE/data"
    HS_DIR="$TOR_BASE/hidden_service"
    TORRC="$TOR_BASE/torrc"
    mkdir -p "$TOR_DATA" "$HS_DIR"
    chmod 700 "$HS_DIR"

    cat > "$TORRC" <<EOF
DataDirectory $TOR_DATA
SocksPort 127.0.0.1:9050
HiddenServiceDir $HS_DIR
HiddenServicePort 80 127.0.0.1:$PORT
Log notice stdout
EOF

    run_server_background

    tor -f "$TORRC" &
    TOR_PID=$!

    for _ in $(seq 1 60); do
      [ -f "$HS_DIR/hostname" ] && break
      sleep 1
    done

    ONION="$(cat "$HS_DIR/hostname" 2>/dev/null || true)"
    echo ""
    echo "=========================================="
    echo " CipherNode Termux + Tor"
    echo "=========================================="
    [ -n "$ONION" ] && echo " Onion : http://$ONION" || echo " Onion : henuz hazir degil"
    echo " Local : http://localhost:$PORT/app"
    echo "=========================================="
    echo ""

    trap 'kill "$SERVER_PID" "$TOR_PID" 2>/dev/null || true; exit 0' INT TERM
    wait "$SERVER_PID"
    ;;

  *)
    echo "Kullanim: bash termux-start.sh [server|cloudflare|localtunnel|tor]"
    exit 1
    ;;
esac
