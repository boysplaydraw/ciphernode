# ╔══════════════════════════════════════════════════════════════╗
# ║              CipherNode — Go Relay Server Dockerfile         ║
# ║    Uçtan uca şifreli, Tor destekli anonim mesajlaşma relay   ║
# ╚══════════════════════════════════════════════════════════════╝
#
# 2 aşamalı build:
#   1. builder → Go backend projesini derle
#   2. runner  → Küçük, güvenli final alpine image (dev araçları yok)

# ── Aşama 1: Build ─────────────────────────────────────────────
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Önce go.mod kopyala ve bağımlılıkları yükle (cache dostu)
COPY server-go/go.mod ./
RUN go mod download || true

# Tüm kaynak kodlarını kopyala
COPY server-go/ ./

# Go binary'sini ve bağımlılıklarını optimize şekilde derle
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o ciphernode-relay .

# ── Aşama 2: Final (runner) ─────────────────────────────────────
FROM alpine:3.19 AS runner

# Sistem araçları:
#   openssl  → self-signed SSL sertifikası üretmek için
#   ca-certificates → Harici TLS bağlantıları için
RUN apk add --no-cache openssl ca-certificates

WORKDIR /app

# Güvenlik: root olmayan kullanıcı
RUN addgroup --system --gid 1001 ciphernode-group && \
    adduser  --system --uid 1001 --ingroup ciphernode-group ciphernode-user

# Sadece gerekli Go binary'sini kopyala
COPY --from=builder /app/ciphernode-relay ./ciphernode-relay

# SSL sertifika dizini (volume ile kalıcı hale getirilir)
RUN mkdir -p /app/ssl && chown -R ciphernode-user:ciphernode-group /app/ssl

# Entrypoint script (SSL başlatma mantığı burada)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && chown ciphernode-user:ciphernode-group /app/docker-entrypoint.sh

USER ciphernode-user

# ── Varsayılan ortam değişkenleri ───────────────────────────────
ENV PORT=5000
ENV HTTPS=false

# ── Portlar ─────────────────────────────────────────────────────
# 5000 → HTTP / doğrudan erişim
#  443 → HTTPS (varsayılan SSL portu)
#   80 → HTTP → HTTPS yönlendirme
EXPOSE 5000 443 80

# ── Sağlık kontrolü ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider \
        http://localhost:${PORT:-5000}/api/health 2>/dev/null \
        || exit 1

# ── Image meta verileri ─────────────────────────────────────────
LABEL org.opencontainers.image.title="CipherNode Go Relay"
LABEL org.opencontainers.image.description="Uçtan uca şifreli, Go tabanlı yüksek performanslı güvenlik relay sunucusu"
LABEL org.opencontainers.image.url="https://boysplaydraw.github.io/ciphernode"
LABEL org.opencontainers.image.source="https://github.com/boysplaydraw/ciphernode"
LABEL org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
