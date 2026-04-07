#!/bin/sh
# ============================================================
# CipherNode Docker Entrypoint
# - HTTPS=false degilse her zaman SSL ile calisiyor
# - SSL_DOMAIN yoksa otomatik self-signed sertifika uretir
# - SSL_DOMAIN varsa Let's Encrypt (certbot) kullanir
# ============================================================
set -e

SSL_DIR=/app/ssl
mkdir -p "$SSL_DIR"

# ── HTTPS devre disi mi? ─────────────────────────────────────
if [ "$HTTPS" = "false" ]; then
    echo "[entrypoint] HTTPS=false — HTTP modunda baslatiliyor (port $PORT)"
    exec node server_dist/index.js
fi

# ── Sertifika zaten var mi? ──────────────────────────────────
CERT_FILE="$SSL_DIR/cert.pem"
KEY_FILE="$SSL_DIR/key.pem"

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    # Sertifika var — sona erme tarihini kontrol et (30 gundan az kaldiysa yenile)
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2)
    if [ -n "$EXPIRY" ]; then
        EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || date -jf "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null || echo 0)
        NOW_EPOCH=$(date +%s)
        DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
        if [ "$DAYS_LEFT" -gt 30 ]; then
            echo "[SSL] Mevcut sertifika gecerli ($DAYS_LEFT gun kaldi)"
            export SSL_CERT="$CERT_FILE"
            export SSL_KEY="$KEY_FILE"
            exec node server_dist/index.js
        fi
        echo "[SSL] Sertifika ${DAYS_LEFT} gunde surecek — yenileniyor..."
    fi
fi

# ── Let's Encrypt (domain varsa) ────────────────────────────
if [ -n "$SSL_DOMAIN" ]; then
    echo "[SSL] Let's Encrypt sertifikasi aliniyor: $SSL_DOMAIN"

    # certbot kurulu mu?
    if command -v certbot >/dev/null 2>&1; then
        certbot certonly \
            --standalone \
            --non-interactive \
            --agree-tos \
            --email "${SSL_EMAIL:-admin@$SSL_DOMAIN}" \
            --domain "$SSL_DOMAIN" \
            --http-01-port 80 \
            || echo "[SSL] certbot basarisiz — self-signed'a geri doniluyor"

        LE_CERT="/etc/letsencrypt/live/$SSL_DOMAIN/fullchain.pem"
        LE_KEY="/etc/letsencrypt/live/$SSL_DOMAIN/privkey.pem"

        if [ -f "$LE_CERT" ] && [ -f "$LE_KEY" ]; then
            cp "$LE_CERT" "$CERT_FILE"
            cp "$LE_KEY"  "$KEY_FILE"
            echo "[SSL] Let's Encrypt sertifikasi kopyalandi"
            export SSL_CERT="$CERT_FILE"
            export SSL_KEY="$KEY_FILE"
            exec node server_dist/index.js
        fi
    else
        echo "[SSL] certbot yok — self-signed sertifika kullanilacak"
    fi
fi

# ── Self-signed sertifika uret ───────────────────────────────
echo "[SSL] Self-signed sertifika olusturuluyor..."

# Sunucu IP'sini bul (SANs icin)
LOCAL_IP=$(hostname -i 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
COMMON_NAME="${SSL_DOMAIN:-$LOCAL_IP}"

# SAN (Subject Alternative Name) listesi: localhost + yerel IP + domain (varsa)
SAN="IP:127.0.0.1,IP:$LOCAL_IP,DNS:localhost"
if [ -n "$SSL_DOMAIN" ]; then
    SAN="$SAN,DNS:$SSL_DOMAIN"
fi

# openssl config (SAN destegi icin)
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

echo "[SSL] Self-signed sertifika olusturuldu"
echo "[SSL]   CN  : $COMMON_NAME"
echo "[SSL]   SAN : $SAN"
echo "[SSL]   Cert: $CERT_FILE"
echo "[SSL]   Key : $KEY_FILE"
echo ""
echo "[SSL] NOT: Tarayici 'Guvenli degil' uyarisi verecektir."
echo "[SSL]   → 'Gelismis' → 'Guvenli degil (devam et)' secenegiyle kabul edin."
echo "[SSL]   Bu uyari sadece ilk baglantigta gosterilir."
echo ""

export SSL_CERT="$CERT_FILE"
export SSL_KEY="$KEY_FILE"

exec node server_dist/index.js
