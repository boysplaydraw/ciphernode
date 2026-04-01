#!/usr/bin/env bash
# ============================================================
# CipherNode — DuckDNS + Port Forwarding kurulumu
# Kullanım: bash scripts/setup-duckdns.sh <domain> <token>
# Örnek:    bash scripts/setup-duckdns.sh ciphernode abc123-token
# ============================================================
# Gereksinimler:
#   1. duckdns.org adresinde ücretsiz hesap ve subdomain
#   2. Modeminizde port forwarding: 5000 → bu makinenin local IP'si
#   3. CGNAT yoksa (ISP tarafında) çalışır — ngrok/cloudflare CGNAT'ı aşar
# ============================================================

set -e

DUCK_DOMAIN="${1:-}"
DUCK_TOKEN="${2:-}"
PORT="${PORT:-5000}"
UPDATE_INTERVAL=300   # 5 dakikada bir IP güncelle

if [ -z "$DUCK_DOMAIN" ] || [ -z "$DUCK_TOKEN" ]; then
  echo ""
  echo "Kullanım: bash scripts/setup-duckdns.sh <subdomain> <token>"
  echo ""
  echo "  subdomain : duckdns.org'dan aldığınız subdomain (sadece isim, .duckdns.org olmadan)"
  echo "  token     : duckdns.org dashboard'unuzdaki token"
  echo ""
  echo "Örnek: bash scripts/setup-duckdns.sh ciphernode-relay abc123-token-xyz"
  echo ""
  echo "Adımlar:"
  echo "  1. https://www.duckdns.org → 'sign in' → subdomain oluştur"
  echo "  2. Token'ı kopyala"
  echo "  3. Modeminizde port forwarding: port 5000 → bu bilgisayarın local IP'si"
  echo "     (Modem arayüzü genellikle: http://192.168.1.1)"
  echo "  4. Bu scripti çalıştır"
  echo ""
  exit 1
fi

# ── CGNAT kontrolü ─────────────────────────────────────────
echo "[duckdns] CGNAT kontrolü yapılıyor..."
PUBLIC_IP=$(curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null)
echo "  Genel IP: $PUBLIC_IP"

# Modem WAN IP almak için (192.168.1.1 varsayılan — gerekirse değiştirin)
MODEM_WAN=$(curl -s --max-time 3 http://192.168.1.1 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | grep -v '192\.168\.' | head -1 2>/dev/null || echo "")
if [ -n "$MODEM_WAN" ] && [ "$MODEM_WAN" != "$PUBLIC_IP" ]; then
  echo ""
  echo "  ⚠ CGNAT tespit edildi!"
  echo "  Modem WAN : $MODEM_WAN"
  echo "  Genel IP  : $PUBLIC_IP"
  echo ""
  echo "  ISP'niz CGNAT kullanıyor. Port forwarding bu durumda çalışmaz."
  echo "  Bunun yerine ngrok veya Cloudflare Tunnel kullanın:"
  echo "    bash scripts/setup-ngrok.sh"
  echo "    bash scripts/setup-cloudflare.sh"
  echo ""
  read -rp "  Yine de devam etmek istiyor musunuz? (e/H) " CONT
  [[ "$CONT" =~ ^[Ee]$ ]] || exit 0
fi

# ── DuckDNS IP güncelleme fonksiyonu ───────────────────────
update_duckdns() {
  RESULT=$(curl -s "https://www.duckdns.org/update?domains=${DUCK_DOMAIN}&token=${DUCK_TOKEN}&ip=")
  if [ "$RESULT" = "OK" ]; then
    echo "[duckdns] $(date '+%H:%M:%S') IP güncellendi → $DUCK_DOMAIN.duckdns.org"
  else
    echo "[duckdns] $(date '+%H:%M:%S') Güncelleme başarısız: $RESULT"
  fi
}

# ── İlk güncelleme ─────────────────────────────────────────
update_duckdns

# ── Sunucuyu başlat ────────────────────────────────────────
echo "[duckdns] Sunucu başlatılıyor (port $PORT)..."
if [ -f "server_dist/index.mjs" ]; then
  NODE_ENV=production HOST=0.0.0.0 PORT=$PORT node server_dist/index.mjs &
elif [ -f "server_dist/index.js" ]; then
  NODE_ENV=production HOST=0.0.0.0 PORT=$PORT node server_dist/index.js &
elif command -v tsx &>/dev/null; then
  NODE_ENV=development HOST=0.0.0.0 PORT=$PORT tsx server/index.ts &
else
  echo "[duckdns] Hata: 'npm run server:build' çalıştırın önce."
  exit 1
fi
SERVER_PID=$!

# ── Arka planda periyodik güncelleme ───────────────────────
(
  while true; do
    sleep $UPDATE_INTERVAL
    update_duckdns
  done
) &
UPDATER_PID=$!

echo ""
echo "=========================================="
echo " CipherNode + DuckDNS Hazır"
echo "=========================================="
echo " Domain  : http://${DUCK_DOMAIN}.duckdns.org:${PORT}"
echo " Genel IP: $PUBLIC_IP"
echo " IP güncelleme: her ${UPDATE_INTERVAL}s"
echo ""
echo " Uygulamada:"
echo "   Ayarlar → Ağ Ayarları → Özel Sunucu"
echo "   URL: http://${DUCK_DOMAIN}.duckdns.org:${PORT}"
echo ""
echo " Modem ayarı (bir kez yapılır):"
echo "   Port forwarding: $PORT → $(hostname -I | awk '{print $1}'):$PORT"
echo "=========================================="
echo " Çıkmak için Ctrl+C"
echo ""

trap "kill $SERVER_PID $UPDATER_PID 2>/dev/null; exit 0" INT TERM
wait $SERVER_PID
