# Stage 1 — Frontend build
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2 — Backend build
FROM rust:1.91-bookworm AS backend
RUN apt-get update && apt-get install -y libsqlite3-dev pkg-config meson ninja-build nasm git && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 1.5.1 https://code.videolan.org/videolan/dav1d.git /tmp/dav1d \
    && cd /tmp/dav1d \
    && meson setup build --buildtype release --default-library shared --prefix /usr \
    && ninja -C build \
    && ninja -C build install \
    && rm -rf /tmp/dav1d
WORKDIR /build
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY backend/src/ src/
COPY backend/migrations/ migrations/
COPY backend/assets/ assets/
RUN touch src/main.rs && cargo build --release

# Stage 3 — Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libsqlite3-0 openssl && rm -rf /var/lib/apt/lists/*
COPY --from=backend /usr/lib/*/libdav1d* /usr/lib/
WORKDIR /app
COPY --from=backend /build/target/release/transcendence-backend /app/transcendence-backend
COPY --from=frontend /build/dist/ /www/
COPY --from=backend /build/migrations/ /app/migrations/
COPY docker.config.toml /app/config.toml
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
EXPOSE 8080 8443
ENTRYPOINT ["./entrypoint.sh"]
