#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# CipherNode Relay — Termux Başlatma Scripti
# Kullanım: bash termux-start.sh [mod]
#   mod: server (varsayılan), tor, ngrok, cloudflare
#
# GitHub : https://github.com/boysplaydraw/ciphernode
# Site   : https://boysplaydraw.github.io/ciphernode
# ============================================================

set -e

MODE="${1:-server}"
PORT="${PORT:-5000}"

echo "[CipherNode] Termux ortamı hazırlanıyor..."

# ── Gerekli paketleri kur ───────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[CipherNode] Node.js kuruluyor..."
  pkg install -y nodejs
fi

# ── Bağımlılıkları kur ─────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "[CipherNode] Bağımlılıklar kuruluyor..."
  npm install
fi

# ── Sunucuyu derle ─────────────────────────────────────────
if [ ! -d "server_dist" ]; then
  echo "[CipherNode] Sunucu derleniyor..."
  npm run server:build
fi

export NODE_ENV=production
export HOST=0.0.0.0
export PORT=$PORT

# LAN IP
LOCAL_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' \
  || hostname -I 2>/dev/null | awk '{print $1}' \
  || echo "")

# ── Mod seçimi ─────────────────────────────────────────────
case "$MODE" in

  # ── Sadece sunucu (LAN erişimi) ──────────────────────────
  server)
    echo ""
    echo "=========================================="
    echo " CipherNode Relay — Sadece LAN"
    echo "=========================================="
    echo " Lokal : http://localhost:$PORT"
    [ -n "$LOCAL_IP" ] && echo " LAN   : http://$LOCAL_IP:$PORT"
    echo ""
    echo " Dışarıdan erişim için:"
    echo "   bash termux-start.sh tor        (Tor hidden service)"
    echo "   bash termux-start.sh ngrok      (ngrok tünel)"
    echo "   bash termux-start.sh cloudflare (Cloudflare Tunnel)"
    echo "=========================================="
    echo ""
    if [ -f "server_dist/index.mjs" ]; then
      node server_dist/index.mjs
    else
      node server_dist/index.js
    fi
    ;;

  # ── Tor Hidden Service ────────────────────────────────────
  tor)
    if ! command -v tor &>/dev/null; then
      echo "[tor] Tor kuruluyor..."
      pkg install -y tor
    fi

    TOR_DIR="$HOME/.tor/ciphernode"
    TORRC="$PREFIX/etc/tor/torrc"
    mkdir -p "$TOR_DIR"
    chmod 700 "$TOR_DIR"

    # torrc'ye hidden service bloğu ekle
    if ! grep -q "HiddenServiceDir $TOR_DIR" "$TORRC" 2>/dev/null; then
      echo "" >> "$TORRC"
      echo "# CipherNode" >> "$TORRC"
      echo "HiddenServiceDir $TOR_DIR" >> "$TORRC"
      echo "HiddenServicePort 80 127.0.0.1:$PORT" >> "$TORRC"
    fi

    # Sunucuyu lokal başlat (Tor üzerinden dışarı açık)
    if [ -f "server_dist/index.mjs" ]; then
      HOST=127.0.0.1 node server_dist/index.mjs &
    else
      HOST=127.0.0.1 node server_dist/index.js &
    fi
    SERVER_PID=$!
    sleep 2

    echo "[tor] Tor başlatılıyor..."
    tor -f "$TORRC" --quiet &
    TOR_PID=$!

    # .onion adresini bekle
    for i in $(seq 1 30); do
      [ -f "$TOR_DIR/hostname" ] && break
      sleep 1
      echo -n "."
    done
    echo ""

    ONION=$(cat "$TOR_DIR/hostname" 2>/dev/null || echo "henüz alınamadı")

    echo ""
    echo "=========================================="
    echo " CipherNode + Tor Hidden Service"
    echo "=========================================="
    echo " .onion : http://$ONION"
    echo ""
    echo " Uygulamada:"
    echo "   Orbot'u açın → VPN modu aktif edin"
    echo "   Ayarlar → Tor'u Etkinleştir"
    echo "   Ağ Ayarları → Özel Sunucu: http://$ONION"
    echo "=========================================="
    echo " Ctrl+C ile durdur"
    echo ""

    trap "kill $SERVER_PID $TOR_PID 2>/dev/null; exit 0" INT TERM
    wait $SERVER_PID
    ;;

  # ── ngrok tünel ───────────────────────────────────────────
  ngrok)
    if ! command -v ngrok &>/dev/null; then
      echo "[ngrok] ngrok kuruluyor (ARM64)..."
      ARCH=$(uname -m)
      case "$ARCH" in
        aarch64) NGROK_BIN="cloudflared-linux-arm64" ;;
        armv7l)  NGROK_BIN="cloudflared-linux-arm" ;;
        x86_64)  NGROK_BIN="cloudflared-linux-amd64" ;;
        *) echo "Desteklenmeyen mimari: $ARCH"; exit 1 ;;
      esac
      curl -sSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${ARCH/aarch64/arm64}.tgz" | tar xz
      mv ngrok "$PREFIX/bin/"
    fi

    # Sunucuyu başlat
    if [ -f "server_dist/index.mjs" ]; then
      node server_dist/index.mjs &
    else
      node server_dist/index.js &
    fi
    SERVER_PID=$!
    sleep 2

    echo "[ngrok] Tünel açılıyor..."
    ngrok http "$PORT" &
    NGROK_PID=$!
    sleep 3

    TUNNEL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
      | grep -o '"public_url":"[^"]*"' | grep https | head -1 | cut -d'"' -f4)

    echo ""
    echo "=========================================="
    echo " CipherNode + ngrok"
    echo "=========================================="
    [ -n "$TUNNEL" ] && echo " URL: $TUNNEL" || echo " URL: http://localhost:4040 adresine bakın"
    echo "=========================================="
    echo ""

    trap "kill $SERVER_PID $NGROK_PID 2>/dev/null; exit 0" INT TERM
    wait $NGROK_PID
    ;;

  # ── Cloudflare Tunnel ─────────────────────────────────────
  cloudflare)
    if ! command -v cloudflared &>/dev/null; then
      echo "[cloudflare] cloudflared kuruluyor..."
      ARCH=$(uname -m)
      case "$ARCH" in
        aarch64) BIN_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
        armv7l)  BIN_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm" ;;
        x86_64)  BIN_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
        *) echo "Desteklenmeyen mimari: $ARCH"; exit 1 ;;
      esac
      curl -sSL "$BIN_URL" -o "$PREFIX/bin/cloudflared"
      chmod +x "$PREFIX/bin/cloudflared"
    fi

    if [ -f "server_dist/index.mjs" ]; then
      node server_dist/index.mjs &
    else
      node server_dist/index.js &
    fi
    SERVER_PID=$!
    sleep 2

    echo "[cloudflare] Tünel açılıyor..."
    cloudflared tunnel --url "http://localhost:$PORT" 2>&1 | tee /tmp/cf.log &
    CF_PID=$!

    for i in $(seq 1 15); do
      CF_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cf.log 2>/dev/null | head -1)
      [ -n "$CF_URL" ] && break
      sleep 1
    done

    echo ""
    echo "=========================================="
    echo " CipherNode + Cloudflare Tunnel"
    echo "=========================================="
    [ -n "$CF_URL" ] && echo " URL: $CF_URL" || echo " URL: /tmp/cf.log dosyasına bakın"
    echo "=========================================="
    echo ""

    trap "kill $SERVER_PID $CF_PID 2>/dev/null; exit 0" INT TERM
    wait $CF_PID
    ;;

  *)
    echo "Bilinmeyen mod: $MODE"
    echo "Kullanım: bash termux-start.sh [server|tor|ngrok|cloudflare]"
    exit 1
    ;;
esac
