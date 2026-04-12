# syntax=docker/dockerfile:1.7

# ── Stage 1: Build frontend ──────────────────────────────────
FROM node:24-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Rust builder base ───────────────────────────────
FROM rust:1.94-slim-trixie AS chef
RUN cargo install cargo-chef --version ^0.1
RUN apt-get update && apt-get install -y --no-install-recommends \
    libdav1d-dev libsqlite3-dev libzstd-dev pkg-config \
    clang \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build

# ── Stage 3: Prepare dependency recipe ───────────────────────
FROM chef AS planner
WORKDIR /build/backend

# Copy only dependency-shaping files so normal source edits do not invalidate
# dependency cooking layers.
COPY backend/Cargo.toml backend/Cargo.lock backend/build.rs ./

# Minimal crate skeleton required by cargo metadata for dependency planning.
RUN mkdir -p src && printf 'fn main() {}\n' > src/main.rs
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 4: Build backend binary ────────────────────────────
FROM chef AS backend

ARG CARGO_PROFILE=debug

WORKDIR /build/backend

COPY --from=planner /build/backend/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/backend/target \
    if [ "$CARGO_PROFILE" = "release" ]; then \
    cargo chef cook --release --locked --recipe-path recipe.json; \
    else \
    cargo chef cook --locked --recipe-path recipe.json; \
    fi

COPY backend/ ./
COPY game-core/ ../game-core/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/backend/target \
    if [ "$CARGO_PROFILE" = "release" ]; then \
    cargo build --release --locked; \
    else \
    cargo build --locked; \
    fi && \
    cp target/${CARGO_PROFILE}/transcendence-backend /transcendence-backend

# ── Stage 5: Runtime ─────────────────────────────────────────
FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 libdav1d7 libzstd1 libstdc++6 ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*

RUN echo 'app:x:1000:1000::/home/app:/bin/false' >> /etc/passwd \
    && echo 'app:x:1000:' >> /etc/group \
    && mkdir -p /home/app \
    && chown 1000:1000 /home/app
WORKDIR /app

COPY --from=backend /transcendence-backend ./transcendence-backend
COPY --from=frontend /build/dist /www
COPY --from=backend /build/backend/data/ ./assets/
COPY --from=backend /build/backend/data/map_colliders.json ./assets/map_colliders.json


RUN mkdir -p data acme && chown -R app:app /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080 8443/tcp 8443/udp

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
