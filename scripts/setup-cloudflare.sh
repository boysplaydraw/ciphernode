#!/usr/bin/env bash
# ============================================================
# CipherNode — Cloudflare Tunnel kurulumu
# Kullanım: bash scripts/setup-cloudflare.sh
#
# GitHub : https://github.com/boysplaydraw/ciphernode
# Site   : https://boysplaydraw.github.io/ciphernode
# ============================================================
# Avantajlar:
#   - Port forwarding gerekmez
#   - CGNAT arkasında çalışır
#   - Ücretsiz, kayıt gerektirmeyen hızlı tünel (trycloudflare.com)
#   - Kalıcı domain için Cloudflare hesabı + kendi domain
# ============================================================

set -e

PORT="${PORT:-5000}"

# ── cloudflared kurulu mu? ──────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
  echo "[cloudflare] cloudflared bulunamadı. Kuruluyor..."

  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)
      case "$ARCH" in
        x86_64)
          curl -sSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
            -o /tmp/cloudflared && chmod +x /tmp/cloudflared
          sudo mv /tmp/cloudflared /usr/local/bin/cloudflared 2>/dev/null \
            || mv /tmp/cloudflared "$HOME/.local/bin/cloudflared"
          ;;
        aarch64|arm64)
          curl -sSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
            -o /tmp/cloudflared && chmod +x /tmp/cloudflared
          sudo mv /tmp/cloudflared /usr/local/bin/cloudflared 2>/dev/null \
            || mv /tmp/cloudflared "$HOME/.local/bin/cloudflared"
          ;;
        armv7l)
          curl -sSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm \
            -o /tmp/cloudflared && chmod +x /tmp/cloudflared
          sudo mv /tmp/cloudflared /usr/local/bin/cloudflared 2>/dev/null \
            || mv /tmp/cloudflared "$HOME/.local/bin/cloudflared"
          ;;
        *)
          echo "[cloudflare] Desteklenmeyen mimari: $ARCH"
          echo "  Manuel kurulum: https://developers.cloudflare.com/cloudflared/install/"
          exit 1
          ;;
      esac
      ;;
    Darwin)
      if command -v brew &>/dev/null; then
        brew install cloudflare/cloudflare/cloudflared
      else
        echo "[cloudflare] Homebrew bulunamadı. https://developers.cloudflare.com/cloudflared/install/"
        exit 1
      fi
      ;;
    *)
      # Termux
      if command -v pkg &>/dev/null; then
        pkg install cloudflared 2>/dev/null || {
          echo "[cloudflare] Termux'ta cloudflared paketi bulunamadı."
          echo "  ARM binary'si indiriliyor..."
          curl -sSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
            -o "$PREFIX/bin/cloudflared" && chmod +x "$PREFIX/bin/cloudflared"
        }
      fi
      ;;
  esac
fi

# ── Sunucuyu arka planda başlat ─────────────────────────────
echo "[cloudflare] Sunucu başlatılıyor (port $PORT)..."
if [ -f "server_dist/index.mjs" ]; then
  NODE_ENV=production HOST=0.0.0.0 PORT=$PORT node server_dist/index.mjs &
elif [ -f "server_dist/index.js" ]; then
  NODE_ENV=production HOST=0.0.0.0 PORT=$PORT node server_dist/index.js &
elif command -v tsx &>/dev/null; then
  NODE_ENV=development HOST=0.0.0.0 PORT=$PORT tsx server/index.ts &
else
  echo "[cloudflare] Hata: 'npm run server:build' çalıştırın önce."
  exit 1
fi
SERVER_PID=$!

sleep 2

# ── Hızlı tünel (kayıt gerektirmez) ────────────────────────
echo "[cloudflare] Tünel açılıyor (trycloudflare.com)..."
echo "  NOT: Her açılışta URL değişir. Kalıcı URL için cloudflared tunnel login"
echo ""

cloudflared tunnel --url "http://localhost:$PORT" 2>&1 | tee /tmp/cf_tunnel.log &
CF_PID=$!

# URL çıkana kadar bekle
for i in $(seq 1 15); do
  CF_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cf_tunnel.log 2>/dev/null | head -1)
  [ -n "$CF_URL" ] && break
  sleep 1
done

echo ""
echo "=========================================="
echo " CipherNode + Cloudflare Tunnel Hazır"
echo "=========================================="
if [ -n "$CF_URL" ]; then
  echo " Dış URL  : $CF_URL"
  echo ""
  echo " Uygulamada:"
  echo "   Ayarlar → Ağ Ayarları → Özel Sunucu"
  echo "   URL: $CF_URL"
else
  echo " URL henüz alınamadı — /tmp/cf_tunnel.log dosyasını kontrol edin"
fi
echo " Yerel URL: http://localhost:$PORT"
echo "=========================================="
echo " Kalıcı domain için: cloudflared tunnel login"
echo " Çıkmak için Ctrl+C"
echo ""

trap "kill $SERVER_PID $CF_PID 2>/dev/null; exit 0" INT TERM
wait $CF_PID
