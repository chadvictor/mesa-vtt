# syntax=docker/dockerfile:1
# Mesa VTT — All-in-One Multi-Stage Production Image
# Build & run:
#   docker build -t mesa-vtt .
#   docker run -p 8094:8094 -v mesa_vtt_data:/data mesa-vtt

# Stage 1: Build React 19 + TypeScript + Three.js client SPA
FROM node:22-alpine AS client-builder
WORKDIR /build

COPY client/package*.json ./client/
RUN cd client && npm install --no-audit --no-fund

COPY data/ ./data/
COPY systems/ ./systems/
COPY client/ ./client/
RUN cd client && npm run build

# Stage 2: Build Go 1.26 authoritative server & distroless healthcheck binary
FROM golang:1.26-alpine AS server-builder
WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY data/ ./data/
COPY server/ ./server/
RUN mkdir -p /out /data \
    && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/mesa-vtt ./server/cmd/server \
    && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/healthcheck ./server/cmd/healthcheck

# Stage 3: Minimal distroless non-root runtime serving both API/WS and built SPA
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app

COPY --from=server-builder /out/mesa-vtt /app/mesa-vtt
COPY --from=server-builder /out/healthcheck /app/healthcheck
COPY --from=client-builder /build/client/dist /app/web
COPY --from=server-builder --chown=65532:65532 /data /data

ENV LISTEN_ADDRESS=:8094 \
    STATIC_DIR=/app/web \
    MESA_DATA_FILE=/data/mesa-vtt-data.json

EXPOSE 8094
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/app/healthcheck"]

ENTRYPOINT ["/app/mesa-vtt"]
