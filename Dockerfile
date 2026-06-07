FROM node:22-alpine AS web-builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

ENV NODE_ENV=production
ENV CI=1
# Go relay yalnızca ham WebSocket (/ws) konuşur. Paketlenen web istemcisi de ham WS
# transport kullanmalı; aksi halde socket.io ile bağlanamaz ve durum "Offline" kalır.
ENV EXPO_PUBLIC_RELAY_TRANSPORT=websocket

RUN npx expo export --platform web --output-dir dist

FROM --platform=$BUILDPLATFORM golang:alpine AS go-builder

WORKDIR /src

COPY server/go/go.mod server/go/go.sum* ./
RUN go mod download

COPY server/go/ ./

ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/ciphernode-server ./cmd/ciphernode-server

FROM alpine:latest AS runner

WORKDIR /app

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache ca-certificates nodejs && \
    addgroup -S ciphernode && \
    adduser -S ciphernode -G ciphernode

COPY --from=go-builder /out/ciphernode-server ./ciphernode-server
COPY --from=web-builder /app/dist ./dist
COPY --from=web-builder /app/assets ./assets
COPY --from=web-builder /app/website ./website
COPY --from=web-builder /app/app.json ./app.json

USER ciphernode

ENV HOST=0.0.0.0
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||5000) + '/api/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

LABEL org.opencontainers.image.title="CipherNode"
LABEL org.opencontainers.image.description="End-to-end encrypted messaging relay with bundled web client"
LABEL org.opencontainers.image.url="https://cipher-node.site"
LABEL org.opencontainers.image.source="https://github.com/boysplaydraw/ciphernode"
LABEL org.opencontainers.image.licenses="GPL-3.0"

CMD ["/app/ciphernode-server"]
