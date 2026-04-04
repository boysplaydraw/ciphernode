#!/usr/bin/env bash
# ============================================================
# CipherNode — Tor Hidden Service kurulumu
# Kullanım: bash scripts/setup-tor-hidden-service.sh
# ============================================================
# Avantajlar:
#   - Port forwarding gerekmez
#   - CGNAT arkasında çalışır
#   - Sunucu IP'si tamamen gizli kalır
#   - Herhangi bir ağdan erişilebilir (Tor üzerinden)
# Gereksinim: Uygulamada Tor aktif + SOCKS5 proxy (Orbot/Tor Browser)
# ============================================================

set -e

PORT="${PORT:-5000}"
TOR_DATA_DIR="${TOR_DATA_DIR:-/var/lib/tor/ciphernode}"
TORRC_PATH=""

# ── Root mu? ────────────────────────────────────────────────
IS_ROOT=false
[ "$(id -u)" = "0" ] && IS_ROOT=true

# ── Termux ortamı mı? ───────────────────────────────────────
IS_TERMUX=false
[ -n "$PREFIX" ] && [[ "$PREFIX" == *termux* ]] && IS_TERMUX=true

# ── Tor kurulu mu? ──────────────────────────────────────────
if ! command -v tor &>/dev/null; then
  echo "[tor] Tor bulunamadı. Kuruluyor..."
  if $IS_TERMUX; then
    pkg install -y tor
  elif command -v apt-get &>/dev/null; then
    $IS_ROOT && apt-get install -y tor || sudo apt-get install -y tor
  elif command -v dnf &>/dev/null; then
    $IS_ROOT && dnf install -y tor || sudo dnf install -y tor
  elif command -v pacman &>/dev/null; then
    $IS_ROOT && pacman -S --noconfirm tor || sudo pacman -S --noconfirm tor
  elif command -v brew &>/dev/null; then
    brew install tor
  else
    echo "[tor] Hata: Tor otomatik kurulamadı."
    echo "  Ubuntu/Debian: sudo apt install tor"
    echo "  Arch:          sudo pacman -S tor"
    echo "  macOS:         brew install tor"
    echo "  Termux:        pkg install tor"
    exit 1
  fi
fi

# ── torrc yapılandırması ────────────────────────────────────
if $IS_TERMUX; then
  TOR_DATA_DIR="$HOME/.tor/ciphernode"
  TORRC_PATH="$PREFIX/etc/tor/torrc"
  mkdir -p "$TOR_DATA_DIR"
  chmod 700 "$TOR_DATA_DIR"
elif [ -f "/etc/tor/torrc" ]; then
  TORRC_PATH="/etc/tor/torrc"
  if $IS_ROOT; then
    mkdir -p "$TOR_DATA_DIR"
    chown debian-tor:debian-tor "$TOR_DATA_DIR" 2>/dev/null || chown tor:tor "$TOR_DATA_DIR" 2>/dev/null || true
    chmod 700 "$TOR_DATA_DIR"
  else
    TOR_DATA_DIR="$HOME/.tor/ciphernode"
    mkdir -p "$TOR_DATA_DIR"
    chmod 700 "$TOR_DATA_DIR"
  fi
else
  TOR_DATA_DIR="$HOME/.tor/ciphernode"
  TORRC_PATH="$HOME/.tor/torrc"
  mkdir -p "$TOR_DATA_DIR" "$(dirname "$TORRC_PATH")"
  chmod 700 "$TOR_DATA_DIR"
fi

# Hidden service bloğunu torrc'ye ekle (yoksa)
HIDDEN_SERVICE_BLOCK="HiddenServiceDir $TOR_DATA_DIR
HiddenServicePort 80 127.0.0.1:$PORT"

if [ -f "$TORRC_PATH" ] && grep -q "HiddenServiceDir $TOR_DATA_DIR" "$TORRC_PATH"; then
  echo "[tor] Hidden service zaten yapılandırılmış: $TORRC_PATH"
else
  echo "[tor] torrc güncelleniyor: $TORRC_PATH"
  if $IS_ROOT && [ "$TORRC_PATH" = "/etc/tor/torrc" ]; then
    echo "" >> "$TORRC_PATH"
    echo "# CipherNode Hidden Service" >> "$TORRC_PATH"
    echo "$HIDDEN_SERVICE_BLOCK" >> "$TORRC_PATH"
  else
    cat >> "$TORRC_PATH" << EOF

# CipherNode Hidden Service
$HIDDEN_SERVICE_BLOCK
EOF
  fi
fi

# ── .env yükle (varsa) ─────────────────────────────────────
[ -f .env ] && set -a && source .env && set +a

# ── Sunucuyu başlat ────────────────────────────────────────
echo "[tor] Relay sunucusu başlatılıyor (port $PORT)..."
if [ -d "server_dist" ] && [ -f "server_dist/index.mjs" ]; then
  NODE_ENV=production HOST=127.0.0.1 PORT=$PORT node server_dist/index.mjs &
elif [ -d "server_dist" ] && [ -f "server_dist/index.js" ]; then
  NODE_ENV=production HOST=127.0.0.1 PORT=$PORT node server_dist/index.js &
elif command -v tsx &>/dev/null; then
  NODE_ENV=production HOST=127.0.0.1 PORT=$PORT tsx server/index.ts &
elif command -v npx &>/dev/null; then
  NODE_ENV=production HOST=127.0.0.1 PORT=$PORT npx tsx server/index.ts &
else
  echo "[tor] Hata: tsx bulunamadı. 'npm install' veya 'npm run server:build' çalıştırın."
  exit 1
fi
SERVER_PID=$!

sleep 2

# ── Tor başlat ─────────────────────────────────────────────
echo "[tor] Tor başlatılıyor..."
if $IS_ROOT && systemctl is-active tor &>/dev/null; then
  systemctl restart tor
elif $IS_ROOT && service tor status &>/dev/null; then
  service tor restart
elif [ -n "$TORRC_PATH" ]; then
  tor -f "$TORRC_PATH" --quiet &
  TOR_PID=$!
fi

# .onion adresini bekle
echo "[tor] .onion adresi oluşturuluyor..."
for i in $(seq 1 30); do
  ONION_FILE="$TOR_DATA_DIR/hostname"
  if [ -f "$ONION_FILE" ]; then
    ONION_ADDR=$(cat "$ONION_FILE")
    break
  fi
  sleep 1
  echo -n "."
done
echo ""

echo ""
echo "=========================================="
echo " CipherNode Tor Hidden Service Hazır"
echo "=========================================="
if [ -n "$ONION_ADDR" ]; then
  # .env dosyasına ONION_ADDRESS yaz — sunucu /api/onion-address ile döndürsün
  if [ -f .env ]; then
    grep -v "^ONION_ADDRESS=" .env > .env.tmp && mv .env.tmp .env
  fi
  echo "ONION_ADDRESS=$ONION_ADDR" >> .env
  echo " .onion adres: http://$ONION_ADDR"
  echo ""
  echo " Uygulamada:"
  echo "   1. Ayarlar → Güvenlik → Tor'u Etkinleştir"
  echo "   2. Ayarlar → Ağ Ayarları → Özel Sunucu"
  echo "      URL: http://$ONION_ADDR"
  echo ""
  echo " Mobil (Android):"
  echo "   Orbot uygulamasını kurun ve başlatın"
  echo "   Sonra uygulamada Tor'u etkinleştirin"
else
  echo " .onion adresi alınamadı — $TOR_DATA_DIR/hostname kontrol edin"
fi
echo " Lokal  : http://127.0.0.1:$PORT (sadece Tor üzerinden)"
echo "=========================================="
echo " Çıkmak için Ctrl+C"
echo ""

trap "kill $SERVER_PID ${TOR_PID:-} 2>/dev/null; exit 0" INT TERM
wait $SERVER_PID
