# ── Stage 1: Build frontend ──────────────────────────────────
FROM node:24-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ───────────────────────────────────
FROM rust:1.94-slim-trixie AS backend

RUN apt-get update && apt-get install -y --no-install-recommends \
        libdav1d-dev libsqlite3-dev libzstd-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY backend/ ./

ARG CARGO_PROFILE=debug
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    if [ "$CARGO_PROFILE" = "release" ]; then \
        cargo build --release; \
    else \
        cargo build; \
    fi && \
    cp target/${CARGO_PROFILE}/transcendence-backend /transcendence-backend

# ── Stage 3: Runtime ─────────────────────────────────────────
FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libsqlite3-0 libdav1d7 libzstd1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/false app
WORKDIR /app

COPY --from=backend /transcendence-backend ./transcendence-backend
COPY --from=frontend /build/dist /www

RUN mkdir -p data acme && chown -R app:app /app

USER app

EXPOSE 8080 8443/tcp 8443/udp

ENTRYPOINT ["./transcendence-backend"]
