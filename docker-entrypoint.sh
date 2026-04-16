#!/bin/sh
# ============================================================
# CipherNode — Docker Entrypoint
#
# SSL sertifika öncelik sırası:
#   1. /etc/letsencrypt/live/$SSL_DOMAIN/  (certbot container ile paylaşılan volume)
#   2. /app/ssl/cert.pem + /app/ssl/key.pem (docker volume, self-signed veya özel)
#   3. Hiçbiri yoksa → otomatik self-signed üret ve /app/ssl/ 'e kaydet
#
# Modlar:
#   HTTPS=false                  → HTTP (port 5000), SSL yok
#   HTTPS=true, SSL_DOMAIN=      → Self-signed (otomatik üretilir)
#   HTTPS=true, SSL_DOMAIN=x.com → Önce Let's Encrypt dene, yoksa self-signed
# ============================================================
set -e

SSL_DIR=/app/ssl
mkdir -p "$SSL_DIR"

# ── Yardımcı fonksiyon ────────────────────────────────────────
start_server() {
    echo "[CipherNode] Sunucu başlatılıyor..."
    exec node server_dist/index.mjs
}

# ── HTTPS devre dışı mı? ─────────────────────────────────────
if [ "$HTTPS" = "false" ]; then
    echo "[CipherNode] HTTP modu — port ${PORT:-5000}"
    start_server
fi

CERT_FILE="$SSL_DIR/cert.pem"
KEY_FILE="$SSL_DIR/key.pem"

# ── 1. Mevcut sertifika geçerli mi? ──────────────────────────
check_cert_valid() {
    local cert_path="$1"
    if [ ! -f "$cert_path" ]; then return 1; fi
    EXPIRY=$(openssl x509 -enddate -noout -in "$cert_path" 2>/dev/null | cut -d= -f2)
    [ -z "$EXPIRY" ] && return 1
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null \
        || date -jf "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null \
        || echo 0)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
    if [ "$DAYS_LEFT" -gt 30 ]; then
        echo "[SSL] Sertifika geçerli (${DAYS_LEFT} gün kaldı): $cert_path"
        return 0
    fi
    echo "[SSL] Sertifika ${DAYS_LEFT} günde dolacak: $cert_path"
    return 1
}

# ── 2. Let's Encrypt sertifikasını kontrol et ─────────────────
# (certbot container tarafından /etc/letsencrypt volume'una yazılmış olabilir)
if [ -n "$SSL_DOMAIN" ]; then
    LE_CERT="/etc/letsencrypt/live/$SSL_DOMAIN/fullchain.pem"
    LE_KEY="/etc/letsencrypt/live/$SSL_DOMAIN/privkey.pem"

    if [ -f "$LE_CERT" ] && [ -f "$LE_KEY" ]; then
        if check_cert_valid "$LE_CERT"; then
            echo "[SSL] Let's Encrypt sertifikası kullanılıyor: $SSL_DOMAIN"
            export SSL_CERT="$LE_CERT"
            export SSL_KEY="$LE_KEY"
            start_server
        fi
        echo "[SSL] Let's Encrypt sertifikası süresi dolmak üzere."
        echo "[SSL]   Yenilemek için: docker compose --profile ssl run --rm certbot"
        # Süresi dolmak üzere olsa bile devam et — en azından çalışsın
        export SSL_CERT="$LE_CERT"
        export SSL_KEY="$LE_KEY"
        start_server
    fi

    # Sertifika yok — kullanıcıya bilgi ver
    echo "[SSL] Let's Encrypt sertifikası bulunamadı."
    echo "[SSL]   İlk kurulum için şu komutu çalıştırın:"
    echo "[SSL]   docker compose --profile ssl run --rm certbot"
    echo "[SSL]   (Ardından: docker compose restart ciphernode-relay)"
    echo "[SSL]   Şimdilik self-signed sertifika ile devam ediliyor..."
fi

# ── 3. /app/ssl/ volume'undaki mevcut sertifikayı kontrol et ──
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    if check_cert_valid "$CERT_FILE"; then
        export SSL_CERT="$CERT_FILE"
        export SSL_KEY="$KEY_FILE"
        start_server
    fi
fi

# ── 4. Self-signed sertifika üret ─────────────────────────────
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
echo "[SSL]   Alan    : $COMMON_NAME"
echo "[SSL]   Konum   : $CERT_FILE"
echo "[SSL]"
echo "[SSL]   Tarayıcı 'Güvenli Değil' uyarısı verecektir — bu normaldir."
echo "[SSL]   Chrome/Edge → Gelişmiş → yine de devam et"
echo "[SSL]   Firefox     → Riski Kabul Et ve Devam Et"
echo ""

export SSL_CERT="$CERT_FILE"
export SSL_KEY="$KEY_FILE"

start_server
