# ── Stage 1: Build frontend ──────────────────────────────────
FROM node:24-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: cargo-chef planner ─────────────────────────────
FROM rust:1.94-slim-trixie AS chef
RUN cargo install cargo-chef
RUN apt-get update && apt-get install -y --no-install-recommends \
        libdav1d-dev libsqlite3-dev libzstd-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build

# ── Stage 3: Prepare dependency recipe ─────────────────────
FROM chef AS planner
COPY backend/ ./
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 4: Build dependencies (cached unless Cargo.toml/lock change)
FROM chef AS backend

ARG CARGO_PROFILE=debug

COPY --from=planner /build/recipe.json recipe.json
RUN if [ "$CARGO_PROFILE" = "release" ]; then \
        cargo chef cook --release --recipe-path recipe.json; \
    else \
        cargo chef cook --recipe-path recipe.json; \
    fi

COPY backend/ ./
RUN if [ "$CARGO_PROFILE" = "release" ]; then \
        cargo build --release; \
    else \
        cargo build; \
    fi && \
    cp target/${CARGO_PROFILE}/transcendence-backend /transcendence-backend

# ── Stage 5: Runtime ─────────────────────────────────────────
FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libsqlite3-0 libdav1d7 libzstd1 ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*

RUN echo 'app:x:1000:1000::/home/app:/bin/false' >> /etc/passwd \
    && echo 'app:x:1000:' >> /etc/group \
    && mkdir -p /home/app \
    && chown 1000:1000 /home/app
WORKDIR /app

COPY --from=backend /transcendence-backend ./transcendence-backend
COPY --from=frontend /build/dist /www

RUN mkdir -p data acme && chown -R app:app /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080 8443/tcp 8443/udp

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
