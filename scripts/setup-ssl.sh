#!/usr/bin/env bash
# ============================================================
# CipherNode — SSL Sertifikası Kurulumu (Let's Encrypt + nginx)
# Kullanım: sudo bash scripts/setup-ssl.sh <domain> [email]
# Örnek:    sudo bash scripts/setup-ssl.sh relay.example.com admin@example.com
# ============================================================
# Gereksinimler:
#   - VPS veya sunucu (statik IP)
#   - Domain adı (A kaydı bu sunucuya yönlendirilmiş olmalı)
#   - Ubuntu/Debian tabanlı OS önerilir
#
# Ne yapar:
#   1. nginx kurar ve CipherNode için reverse proxy ayarlar
#   2. certbot ile ücretsiz Let's Encrypt SSL sertifikası alır
#   3. HTTP → HTTPS yönlendirmesi ayarlar
#   4. Otomatik sertifika yenileme (cron) kurar
#   5. CipherNode sunucusunu systemd servisi olarak başlatır
# ============================================================

set -e

DOMAIN="${1:-}"
EMAIL="${2:-admin@${1:-example.com}}"
PORT="${PORT:-5000}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$DOMAIN" ]; then
  echo ""
  echo "Kullanım: sudo bash scripts/setup-ssl.sh <domain> [email]"
  echo ""
  echo "  domain : Sunucunuzun domain adı (ör: relay.example.com)"
  echo "           Bu domainin A kaydı bu sunucunun IP'sini göstermeli"
  echo "  email  : Let's Encrypt bildirimler için e-posta (opsiyonel)"
  echo ""
  echo "Örnek: sudo bash scripts/setup-ssl.sh relay.example.com admin@example.com"
  echo ""
  echo "Domain yoksa ücretsiz seçenekler:"
  echo "  DuckDNS : https://www.duckdns.org (örn: cipher.duckdns.org)"
  echo "  ngrok   : bash scripts/setup-ngrok.sh    (otomatik SSL)"
  echo "  CF Tünel: bash scripts/setup-cloudflare.sh (otomatik SSL)"
  echo ""
  exit 1
fi

if [ "$(id -u)" != "0" ]; then
  echo "Hata: Bu script root olarak çalıştırılmalı (sudo)"
  exit 1
fi

echo "[ssl] Domain: $DOMAIN"
echo "[ssl] Email:  $EMAIL"
echo "[ssl] Port:   $PORT"
echo ""

# ── 1. Paket güncelleme ─────────────────────────────────────
echo "[ssl] Paketler güncelleniyor..."
apt-get update -qq

# ── 2. nginx kur ───────────────────────────────────────────
echo "[ssl] nginx kuruluyor..."
apt-get install -y -qq nginx

# ── 3. certbot kur ─────────────────────────────────────────
echo "[ssl] certbot kuruluyor..."
apt-get install -y -qq certbot python3-certbot-nginx

# ── 4. Geçici nginx config (certbot doğrulama için) ─────────
echo "[ssl] nginx yapılandırılıyor..."
cat > /etc/nginx/sites-available/ciphernode << NGINX_CONF
server {
    listen 80;
    server_name $DOMAIN;

    # Certbot doğrulama
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
NGINX_CONF

mkdir -p /var/www/certbot
ln -sf /etc/nginx/sites-available/ciphernode /etc/nginx/sites-enabled/ciphernode
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 5. SSL sertifikası al ───────────────────────────────────
echo "[ssl] Let's Encrypt sertifikası alınıyor..."
certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --non-interactive \
  --domain "$DOMAIN"

# ── 6. nginx HTTPS config ───────────────────────────────────
echo "[ssl] nginx HTTPS yapılandırılıyor..."
cat > /etc/nginx/sites-available/ciphernode << NGINX_SSL_CONF
# HTTP → HTTPS yönlendir
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

# HTTPS — CipherNode reverse proxy
server {
    listen 443 ssl;
    http2 on;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    # Güvenli SSL ayarları
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # WebSocket + HTTP proxy (Socket.io için)
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;

        # WebSocket handshake
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Timeout — Socket.io long-polling için yüksek tutulmalı
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Buffer boyutları
        proxy_buffer_size 64k;
        proxy_buffers 8 64k;
    }
}
NGINX_SSL_CONF

nginx -t && systemctl reload nginx
echo "[ssl] nginx HTTPS yapılandırması tamam."

# ── 7. CipherNode systemd servisi ──────────────────────────
echo "[ssl] CipherNode systemd servisi oluşturuluyor..."

# Node.js yolu bul
NODE_PATH=$(which node)

cat > /etc/systemd/system/ciphernode.service << SYSTEMD_CONF
[Unit]
Description=CipherNode Relay Server
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=$APP_DIR
ExecStart=$NODE_PATH $APP_DIR/server_dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1

# Güvenlik kısıtlamaları
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SYSTEMD_CONF

systemctl daemon-reload
systemctl enable ciphernode
systemctl start ciphernode
echo "[ssl] CipherNode servisi başlatıldı."

# ── 8. Otomatik sertifika yenileme ─────────────────────────
echo "[ssl] Otomatik sertifika yenileme cron'u ayarlanıyor..."
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -
echo "[ssl] Cron ayarlandı (her gece 03:00)."

# ── 9. Güvenlik duvarı ─────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  echo "[ssl] UFW kuralları eklendi (80, 443)."
fi

# ── Sonuç ──────────────────────────────────────────────────
echo ""
echo "=========================================="
echo " SSL Kurulumu Tamamlandı!"
echo "=========================================="
echo " URL     : https://$DOMAIN"
echo " Sertifika: /etc/letsencrypt/live/$DOMAIN/"
echo " Yenileme : Otomatik (cron, her gece 03:00)"
echo ""
echo " Servis durumu:"
systemctl status ciphernode --no-pager -l | head -5
echo ""
echo " Uygulamada (app.json veya .env):"
echo "   EXPO_PUBLIC_SERVER_URL=https://$DOMAIN"
echo ""
echo " Sertifika yenilemeyi test etmek için:"
echo "   certbot renew --dry-run"
echo "=========================================="
