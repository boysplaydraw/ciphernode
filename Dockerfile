FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY server ./server
COPY tsconfig.json ./

RUN npm install -g esbuild && \
    esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 ciphernode

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server_dist ./server_dist
COPY --from=builder /app/package.json ./

RUN mkdir -p server/templates && chown -R ciphernode:nodejs server

COPY --chown=ciphernode:nodejs server/templates ./server/templates

USER ciphernode

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "server_dist/index.js"]
