#!/bin/sh
set -e

# Generate self-signed certs if absent (users can mount their own)
if [ ! -f /app/certs/cert.pem ]; then
    mkdir -p /app/certs
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout /app/certs/key.pem \
        -out /app/certs/cert.pem \
        -days 365 -subj "/CN=localhost"
fi

# Create data directory for SQLite if absent
mkdir -p /app/data

exec /app/transcendence-backend
