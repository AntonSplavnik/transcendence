COMPOSE = docker compose

# URL opened by Chrome dev instance (override: make dev CHROME_URL=…)
CHROME_URL ?= https://localhost:8443

.PHONY: all lean dev build \
        docker-down docker-clean \
        setup check-cert chrome-dev reset-db \
        install-prek prek-update prek clean

# ── Default: Docker build + run (foreground) ──────────────────

all: setup
	@echo "🚀 Building and starting Docker containers..."
	@$(COMPOSE) up --build

# ── Lean: sequential build for space-constrained environments ─

lean: setup
	@echo "🏗️  Building sequentially (space-optimised)..."
	@echo "  [1/3] Building frontend stage..."
	@docker build --target frontend .
	@docker builder prune -f --filter type=exec.cachemount >/dev/null
	@echo "  [2/3] Building backend stage..."
	@docker build --target backend \
		--build-arg CARGO_INCREMENTAL=0 \
		--build-arg "RUSTFLAGS=-C debuginfo=0" \
		.
	@docker builder prune -f --filter type=exec.cachemount >/dev/null
	@echo "  [3/3] Assembling final image..."
	@$(COMPOSE) build \
		--build-arg CARGO_INCREMENTAL=0 \
		--build-arg "RUSTFLAGS=-C debuginfo=0"
	@docker builder prune -f --filter type=exec.cachemount >/dev/null
	@echo "🚀 Starting containers..."
	@$(COMPOSE) up

# ── Dev: Docker background + local Vite hot reload ────────────

dev: setup
	@echo "🛠️ Starting development environment..."
	@$(COMPOSE) up --build -d
	@$(MAKE) chrome-dev CHROME_URL=http://localhost:5173 &
	@trap '$(COMPOSE) down' INT TERM EXIT; \
	cd frontend && npm install && \
		VITE_STREAM_URL=https://localhost:8443/api/stream/connect npm run dev

# ── Local build (for cargo check, cargo test, prek) ──────────

build:
	@cd frontend && npm install && npm run build
	@cd backend && cargo build

# ── Docker management ─────────────────────────────────────────

docker-down:
	@$(COMPOSE) down

docker-clean:
	@$(COMPOSE) down -v --rmi local

# ── Environment setup ─────────────────────────────────────────

setup:
	@echo "⚙️  Setting up environment..."
	@if [ ! -f backend/.env ]; then \
		cp backend/.env.example backend/.env; \
		echo "✅ Created backend/.env from example."; \
	fi
	@if [ ! -f backend/certs/cert.pem ]; then \
		mkdir -p backend/certs; \
		openssl req -x509 -newkey rsa:2048 -nodes \
			-keyout backend/certs/key.pem \
			-out backend/certs/cert.pem \
			-days 825 \
			-subj "/CN=localhost" \
			-addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1,IP:0.0.0.0" \
			2>/dev/null; \
		echo "✅ Generated self-signed TLS certificate in backend/certs/."; \
		if command -v certutil >/dev/null 2>&1; then \
			mkdir -p $$HOME/.pki/nssdb; \
			if [ ! -f $$HOME/.pki/nssdb/cert9.db ]; then \
				certutil -d sql:$$HOME/.pki/nssdb -N -f /dev/null 2>/dev/null; \
			fi; \
			certutil -d sql:$$HOME/.pki/nssdb -D -n "transcendence-dev" -f /dev/null 2>/dev/null || true; \
			certutil -d sql:$$HOME/.pki/nssdb -A -n "transcendence-dev" -t "CT,," \
				-i backend/certs/cert.pem -f /dev/null 2>/dev/null; \
			echo "✅ Certificate registered in user NSS store (Chrome/Firefox will trust it)."; \
		else \
			echo "⚠️  certutil not found — install libnss3-tools for browser trust."; \
			echo "   Until then, browsers will show an untrusted certificate warning."; \
		fi; \
	fi

check-cert:
	@if [ ! -f backend/certs/cert.pem ]; then \
		echo "⚠️  WARNING: No certificate found at backend/certs/cert.pem. Run 'make setup'."; \
	else \
		openssl x509 -in backend/certs/cert.pem -noout -text 2>/dev/null | grep -E "Subject:|Not After" | sed 's/^[[:space:]]*/   /'; \
		TRUSTED=$$(certutil -d sql:$$HOME/.pki/nssdb -L 2>/dev/null | grep -c "transcendence-dev" || echo 0); \
		if [ "$$TRUSTED" -gt 0 ]; then \
			echo "✅ Certificate present and trusted in user NSS store."; \
		else \
			echo "✅ Certificate present (not in NSS store — run 'make setup' to register it)."; \
		fi; \
	fi

# ── Chrome dev instance ──────────────────────────────────────

chrome-dev:
	@echo "🌐 Launching Chrome dev instance (WebTransport enabled)..."; \
	CHROME_BIN=""; \
	for bin in google-chrome google-chrome-stable chromium chromium-browser; do \
		if command -v $$bin >/dev/null 2>&1; then \
			CHROME_BIN=$$bin; break; \
		fi; \
	done; \
	if [ -z "$$CHROME_BIN" ]; then \
		echo "⚠️  No Chrome/Chromium binary found in PATH."; \
		exit 1; \
	fi; \
	$$CHROME_BIN \
		--user-data-dir="/tmp/chrome-dev-wt" \
		--webtransport-developer-mode \
		--no-first-run \
		--no-default-browser-check \
		--disable-default-apps \
		--disable-popup-blocking \
		--disable-translate \
		--disable-sync \
		--password-store=basic \
		"$(CHROME_URL)" \
		"http://localhost:8025" >/dev/null 2>&1 &

# ── Database management ───────────────────────────────────────

reset-db:
	@echo "🧹 Resetting database volumes for this project..."
	@$(COMPOSE) down -v

# ── Code quality ──────────────────────────────────────────────

install-prek:
	@curl --proto '=https' --tlsv1.2 -LsSf https://github.com/j178/prek/releases/download/v0.3.2/prek-installer.sh | sh
	@prek self update
	@prek install --hook-type pre-push

prek-update:
	@prek self update
	@prek install --hook-type pre-push

prek:
	@prek run --all-files --stage manual

# ── Cleanup ───────────────────────────────────────────────────

clean:
	@echo "🗑️  Cleaning build artifacts..."
	@rm -rf frontend/dist
	@rm -rf frontend/node_modules
	@rm -rf /tmp/chrome-dev-wt
	@cd backend && cargo clean
	@$(COMPOSE) down -v --rmi local 2>/dev/null || true
	@echo "✨ Workspace cleaned."
