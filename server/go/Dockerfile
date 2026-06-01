FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS build
WORKDIR /src
COPY server/go/go.mod server/go/go.sum* ./
RUN go mod download
COPY server/go/ ./
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/ciphernode-server ./cmd/ciphernode-server

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/ciphernode-server /ciphernode-server
EXPOSE 5000
USER nonroot:nonroot
ENTRYPOINT ["/ciphernode-server"]
