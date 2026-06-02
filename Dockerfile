FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

FROM deps AS builder

WORKDIR /app

COPY . .

ENV NODE_ENV=production
ENV CI=1

RUN npx expo export --platform web --output-dir dist
RUN npm run server:build

FROM node:22-alpine AS runtime-deps

WORKDIR /app

COPY package.runtime.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && \
    npm cache clean --force

FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.runtime.json ./package.json
COPY --from=builder /app/server_dist ./server_dist
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/website ./website
COPY --from=builder /app/app.json ./app.json

RUN addgroup -S ciphernode && adduser -S ciphernode -G ciphernode
USER ciphernode

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5000
ENV HTTPS=true

EXPOSE 5000 443 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

LABEL org.opencontainers.image.title="CipherNode"
LABEL org.opencontainers.image.description="End-to-end encrypted messaging relay with bundled web client"
LABEL org.opencontainers.image.url="https://cipher-node.site"
LABEL org.opencontainers.image.source="https://github.com/boysplaydraw/ciphernode"
LABEL org.opencontainers.image.licenses="MIT"

CMD ["/app/server_dist/index.mjs"]
