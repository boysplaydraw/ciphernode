# ╔══════════════════════════════════════════════════════════════╗
# ║              CipherNode — Relay Server Dockerfile            ║
# ║    Uçtan uca şifreli, Tor destekli anonim mesajlaşma relay   ║
# ╚══════════════════════════════════════════════════════════════╝
#
# 3 aşamalı build:
#   1. deps    → Sadece production bağımlılıkları kur
#   2. builder → TypeScript derle, sunucu binary'sini üret
#   3. runner  → Küçük, güvenli final image (dev araçları yok)

# ── Aşama 1: Production bağımlılıkları ────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./

# Sadece production bağımlılıkları — dev araçları (drizzle-kit, tsc, vb.) dahil değil
RUN npm ci --omit=dev

# ── Aşama 2: Build ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Önce package.json — değişmezse npm ci tekrar çalışmaz (cache)
COPY package*.json ./
RUN npm ci

# Kaynak kodları kopyala
COPY tsconfig.json ./
COPY server  ./server
COPY shared  ./shared

# TypeScript → ESM bundle (node_modules dışarıda → runtime'da lazım)
RUN npx esbuild server/index.ts \
    --platform=node \
    --packages=external \
    --bundle \
    --format=esm \
    --outfile=server_dist/index.mjs

# ── Aşama 3: Final (runner) ─────────────────────────────────────
FROM node:20-alpine AS runner

# Sistem araçları:
#   openssl  → self-signed SSL sertifikası üretmek için
RUN apk add --no-cache openssl

WORKDIR /app

# Güvenlik: root olmayan kullanıcı
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 ciphernode

# Sadece gerekli dosyalar — dev araçları yok, daha küçük image
COPY --from=deps    /app/node_modules   ./node_modules
COPY --from=builder /app/server_dist    ./server_dist
COPY --from=builder /app/package.json   ./

# Sunucu şablon dosyaları
RUN mkdir -p server/templates
COPY --chown=ciphernode:nodejs server/templates ./server/templates

# Pazarlama sitesi (website/index.html → sunucu tarafından serve edilir)
COPY --chown=ciphernode:nodejs website ./website

# SSL sertifika dizini (volume ile kalıcı hale getirilir)
RUN mkdir -p /app/ssl && chown -R ciphernode:nodejs /app/ssl

# Entrypoint script (SSL başlatma mantığı burada)
COPY --chown=ciphernode:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER ciphernode

# ── Varsayılan ortam değişkenleri ───────────────────────────────
ENV NODE_ENV=production
ENV PORT=5000
ENV HOST=0.0.0.0
# HTTPS=false → HTTP modu (port 5000)
# HTTPS=true  → SSL modu (port 443, self-signed veya Let's Encrypt)
ENV HTTPS=true

# ── Portlar ─────────────────────────────────────────────────────
# 5000 → HTTP / doğrudan erişim
#  443 → HTTPS (varsayılan SSL portu)
#   80 → HTTP → HTTPS yönlendirme
EXPOSE 5000 443 80

# ── Sağlık kontrolü ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider \
        --no-check-certificate https://localhost:${SSL_PORT:-443}/api/health 2>/dev/null \
        || wget --no-verbose --tries=1 --spider \
        http://localhost:${PORT:-5000}/api/health 2>/dev/null \
        || exit 1

# ── Image meta verileri ─────────────────────────────────────────
LABEL org.opencontainers.image.title="CipherNode"
LABEL org.opencontainers.image.description="Uçtan uca şifreli, Tor destekli anonim mesajlaşma relay sunucusu"
LABEL org.opencontainers.image.url="https://boysplaydraw.github.io/ciphernode"
LABEL org.opencontainers.image.source="https://github.com/boysplaydraw/ciphernode"
LABEL org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
