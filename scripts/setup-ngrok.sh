#!/usr/bin/env bash
# ============================================================
# CipherNode — ngrok tünel kurulumu
# Kullanım: bash scripts/setup-ngrok.sh [ngrok_token]
# ============================================================
# ngrok ile sunucuyu herhangi bir ağdan erişilebilir yapar.
# Ücretsiz planda URL her yeniden başlatmada değişir.
# Kalıcı URL için: https://dashboard.ngrok.com (ücretsiz plan: 1 statik domain)
# ============================================================

set -e

NGROK_TOKEN="${1:-}"
PORT="${PORT:-5000}"

# ── ngrok kurulu mu? ────────────────────────────────────────
if ! command -v ngrok &>/dev/null; then
  echo "[ngrok] ngrok bulunamadı. Kuruluyor..."

  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)
      case "$ARCH" in
        x86_64) NGROK_URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz" ;;
        aarch64|arm64) NGROK_URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz" ;;
        armv7l) NGROK_URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm.tgz" ;;
        *) echo "[ngrok] Desteklenmeyen mimari: $ARCH"; exit 1 ;;
      esac
      curl -sSL "$NGROK_URL" | tar xz
      mv ngrok /usr/local/bin/ngrok 2>/dev/null || mv ngrok "$HOME/.local/bin/ngrok"
      ;;
    Darwin)
      if command -v brew &>/dev/null; then
        brew install ngrok/ngrok/ngrok
      else
        echo "[ngrok] Homebrew bulunamadı. https://ngrok.com/download adresinden indirin."
        exit 1
      fi
      ;;
    *)
      echo "[ngrok] Termux kullanıyorsanız: pkg install ngrok"
      echo "[ngrok] Windows için: winget install ngrok"
      exit 1
      ;;
  esac
fi

# ── Token yapılandırması ────────────────────────────────────
if [ -n "$NGROK_TOKEN" ]; then
  ngrok config add-authtoken "$NGROK_TOKEN"
  echo "[ngrok] Token ayarlandı."
elif ! ngrok config check &>/dev/null; then
  echo ""
  echo "  ngrok token gerekli. https://dashboard.ngrok.com adresinde ücretsiz hesap açın,"
  echo "  token'ınızı alın ve şu komutla çalıştırın:"
  echo ""
  echo "    bash scripts/setup-ngrok.sh YOUR_TOKEN"
  echo ""
  echo "  Veya token olmadan (her açılışta yeni URL): ngrok http $PORT"
  echo ""
fi

# ── Sunucuyu arka planda başlat ─────────────────────────────
echo "[ngrok] Sunucu $PORT portunda başlatılıyor..."
if [ -f "server_dist/index.mjs" ]; then
  NODE_ENV=production HOST=0.0.0.0 PORT=$PORT node server_dist/index.mjs &
elif [ -f "server_dist/index.js" ]; then
  NODE_ENV=production HOST=0.0.0.0 PORT=$PORT node server_dist/index.js &
elif command -v tsx &>/dev/null; then
  NODE_ENV=development HOST=0.0.0.0 PORT=$PORT tsx server/index.ts &
else
  echo "[ngrok] Hata: server_dist/ bulunamadı. Önce 'npm run server:build' çalıştırın."
  exit 1
fi
SERVER_PID=$!

sleep 2

# ── Tünel aç ───────────────────────────────────────────────
echo "[ngrok] Tünel açılıyor..."
ngrok http "$PORT" --log=stdout &
NGROK_PID=$!

sleep 3

# ── URL'i al ve göster ──────────────────────────────────────
TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"[^"]*"' | grep https | head -1 | cut -d'"' -f4)

echo ""
echo "=========================================="
echo " CipherNode + ngrok Hazır"
echo "=========================================="
if [ -n "$TUNNEL_URL" ]; then
  echo " Dış URL  : $TUNNEL_URL"
  echo ""
  echo " Uygulamada:"
  echo "   Ayarlar → Ağ Ayarları → Özel Sunucu"
  echo "   URL: $TUNNEL_URL"
fi
echo " Yerel URL: http://localhost:$PORT"
echo " ngrok UI : http://localhost:4040"
echo "=========================================="
echo " Çıkmak için Ctrl+C"
echo ""

# Sinyal yakalandığında her ikisini de durdur
trap "kill $SERVER_PID $NGROK_PID 2>/dev/null; exit 0" INT TERM
wait $NGROK_PID
