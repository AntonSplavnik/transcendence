# Production Deployment

## Overview

The production setup uses:

- **GHCR** (GitHub Container Registry) to host Docker images
- **Docker Compose** (`docker-compose.prod.yml`) to run the backend
- **Watchtower** to automatically pull and deploy new images when `main` is updated

## Prerequisites

On your production server:

- Docker and Docker Compose installed
- Access to pull from `ghcr.io/antonsplavnik/transcendence`

### GHCR Authentication

Watchtower needs credentials to pull from a private GHCR registry. Create a GitHub Personal Access Token with `read:packages` scope, then:

```bash
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Docker stores the credentials in `~/.docker/config.json`, which Watchtower reads via the Docker socket.

## Server Setup

### 1. Create the deployment directory

```bash
mkdir -p /opt/transcendence
cd /opt/transcendence
```

### 2. Copy `docker-compose.prod.yml`

Copy the file from the repository or download it:

```bash
curl -O https://raw.githubusercontent.com/AntonSplavnik/Transcendence/main/docker-compose.prod.yml
```

### 3. Create `prod_config.toml`

```toml
serve_dir = "/www"

[log]
format = "compact"
filter_level = "info"

# ACME automatically provisions TLS certificates via Let's Encrypt.
# Do NOT set [tls] when using a domain — ACME handles it.
domain = "yourdomain.com"

[email]
smtp_host = "email-smtp.eu-west-1.amazonaws.com"
smtp_port = 587
smtp_tls = true
smtp_username = "AKIA..."
smtp_password = "..."
from_address = "noreply@yourdomain.com"
base_url = "https://yourdomain.com"
```

### 4. Create `.env`

```env
DATABASE_URL=file:./data/diesel.sqlite
# Generate a unique key for production: openssl rand -base64 32
TOTP_ENC_KEY=<generate a secure base64 key>
```

### 5. Start

```bash
docker compose -f docker-compose.prod.yml up -d
```

## How Auto-Deploy Works

1. A push to `main` triggers the `docker-publish.yml` GitHub Actions workflow
2. The workflow builds the Docker image (multi-stage: frontend + backend compiled inside Docker)
3. The image is pushed to `ghcr.io/antonsplavnik/transcendence:latest`
4. Watchtower (running on the server) polls GHCR
5. When it detects a new `latest` tag, it pulls the image and restarts the backend container

## Ports

The production compose file maps:

- `80` → backend HTTP (8080) — redirects to HTTPS
- `443/tcp` → backend HTTPS (8443)
- `443/udp` → backend QUIC/HTTP3 (8443)

Ensure your firewall allows inbound traffic on ports 80, 443/tcp, and 443/udp.
