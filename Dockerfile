FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY server ./server
COPY tsconfig.json ./

RUN npm install -g esbuild && \
    esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

# ── Runner ────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# openssl: self-signed SSL sertifikasi uretmek icin
# certbot: Let's Encrypt destegi (domain varsa)
RUN apk add --no-cache openssl

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 ciphernode

COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/server_dist   ./server_dist
COPY --from=builder /app/package.json  ./

# Sunucu şablon dosyaları
RUN mkdir -p server/templates
COPY --chown=ciphernode:nodejs server/templates ./server/templates

# SSL sertifika dizini (volume ile kalici hale getirilir)
RUN mkdir -p /app/ssl && chown -R ciphernode:nodejs /app/ssl

# Entrypoint scripti
COPY --chown=ciphernode:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER ciphernode

ENV NODE_ENV=production
ENV PORT=5000
ENV HOST=0.0.0.0
# HTTPS=false yapilirsa HTTP moduna gecer, varsayilan her zaman HTTPS
ENV HTTPS=true

# HTTP redirect (80) + HTTPS (443) + dogrudan erisim (5000)
EXPOSE 5000 443 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider \
        --no-check-certificate https://localhost:${SSL_PORT:-443}/api/health \
        || wget --no-verbose --tries=1 --spider http://localhost:5000/api/health \
        || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
