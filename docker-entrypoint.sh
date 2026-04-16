#!/bin/sh
# ============================================================
# CipherNode — Docker Entrypoint
#
# SSL Modları:
#   HTTPS=false                  → HTTP (port 5000)
#   HTTPS=true, SSL_DOMAIN=      → Otomatik self-signed sertifika
#   HTTPS=true, SSL_DOMAIN=x.com → Let's Encrypt (domain gerekli)
# ============================================================
set -e

SSL_DIR=/app/ssl
mkdir -p "$SSL_DIR"

# ── Yardımcı: sunucuyu başlat ─────────────────────────────────
start_server() {
    exec node server_dist/index.mjs
}

# ── HTTPS devre dışı mı? ─────────────────────────────────────
if [ "$HTTPS" = "false" ]; then
    echo "[CipherNode] HTTP modunda başlatılıyor (port ${PORT:-5000})"
    start_server
fi

CERT_FILE="$SSL_DIR/cert.pem"
KEY_FILE="$SSL_DIR/key.pem"

# ── Mevcut sertifika geçerli mi? ─────────────────────────────
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2)
    if [ -n "$EXPIRY" ]; then
        EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null \
            || date -jf "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null \
            || echo 0)
        NOW_EPOCH=$(date +%s)
        DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
        if [ "$DAYS_LEFT" -gt 30 ]; then
            echo "[SSL] Mevcut sertifika geçerli (${DAYS_LEFT} gün kaldı)"
            export SSL_CERT="$CERT_FILE"
            export SSL_KEY="$KEY_FILE"
            start_server
        fi
        echo "[SSL] Sertifika ${DAYS_LEFT} günde dolacak — yenileniyor..."
    fi
fi

# ── Let's Encrypt (yalnızca SSL_DOMAIN ayarlıysa) ─────────────
if [ -n "$SSL_DOMAIN" ]; then
    echo "[SSL] Let's Encrypt sertifikası deneniyor: $SSL_DOMAIN"

    LE_SUCCESS=0

    # certbot kurulu mu?
    if ! command -v certbot >/dev/null 2>&1; then
        echo "[SSL] UYARI: certbot bu image'da yüklü değil."
        echo "[SSL]   → Let's Encrypt kullanmak için certbot'u manuel kurun"
        echo "[SSL]   → Şimdilik self-signed sertifika oluşturuluyor..."
    else
        # Port 80'in dışarıdan erişilebilir olup olmadığını kontrol et
        # (localhost'ta çalışıyorsak Let's Encrypt zaten başarısız olur)
        certbot certonly \
            --standalone \
            --non-interactive \
            --agree-tos \
            --email "${SSL_EMAIL:-admin@${SSL_DOMAIN}}" \
            --domain "$SSL_DOMAIN" \
            --http-01-port "${HTTP_REDIRECT_PORT:-80}" \
            2>&1 && LE_SUCCESS=1 || {
                echo "[SSL] UYARI: Let's Encrypt başarısız oldu."
                echo "[SSL]   Olası nedenler:"
                echo "[SSL]     1. '$SSL_DOMAIN' bu sunucuya yönlendirilmemiş"
                echo "[SSL]     2. Port ${HTTP_REDIRECT_PORT:-80} dışarıdan erişilemez"
                echo "[SSL]     3. Çok fazla deneme — 1 saat bekleyin"
                echo "[SSL]   → Self-signed sertifika ile devam ediliyor..."
            }

        if [ "$LE_SUCCESS" = "1" ]; then
            LE_CERT="/etc/letsencrypt/live/$SSL_DOMAIN/fullchain.pem"
            LE_KEY="/etc/letsencrypt/live/$SSL_DOMAIN/privkey.pem"

            if [ -f "$LE_CERT" ] && [ -f "$LE_KEY" ]; then
                cp "$LE_CERT" "$CERT_FILE"
                cp "$LE_KEY"  "$KEY_FILE"
                echo "[SSL] Let's Encrypt sertifikası başarıyla alındı!"
                export SSL_CERT="$CERT_FILE"
                export SSL_KEY="$KEY_FILE"
                start_server
            fi
        fi
    fi
fi

# ── Self-signed sertifika üret ────────────────────────────────
echo "[SSL] Self-signed sertifika oluşturuluyor..."

LOCAL_IP=$(hostname -i 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
COMMON_NAME="${SSL_DOMAIN:-$LOCAL_IP}"

SAN="IP:127.0.0.1,IP:${LOCAL_IP},DNS:localhost"
[ -n "$SSL_DOMAIN" ] && SAN="${SAN},DNS:${SSL_DOMAIN}"

OPENSSL_CNF=$(mktemp)
cat > "$OPENSSL_CNF" << OPENSSL_EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions    = v3_req
prompt             = no

[req_distinguished_name]
CN = $COMMON_NAME
O  = CipherNode
C  = TR

[v3_req]
keyUsage         = keyEncipherment, dataEncipherment, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName   = $SAN
basicConstraints = CA:FALSE
OPENSSL_EOF

openssl req -x509 \
    -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out    "$CERT_FILE" \
    -days   3650 \
    -nodes \
    -config "$OPENSSL_CNF" 2>/dev/null

rm -f "$OPENSSL_CNF"

echo "[SSL] Self-signed sertifika oluşturuldu"
echo "[SSL]   Alan Adı : $COMMON_NAME"
echo "[SSL]   SAN      : $SAN"
echo "[SSL]"
echo "[SSL] NOT: Tarayıcı 'Güvenli Değil' uyarısı verecektir."
echo "[SSL]   Chrome/Edge : Gelişmiş → yine de devam et"
echo "[SSL]   Firefox     : Riski Kabul Et ve Devam Et"
echo "[SSL]   Bu uyarı güvensiz bir sunucu değil, sadece doğrulanmamış"
echo "[SSL]   bir sertifika anlamına gelir. İlk girişten sonra hatırlanır."
echo ""

export SSL_CERT="$CERT_FILE"
export SSL_KEY="$KEY_FILE"

start_server
