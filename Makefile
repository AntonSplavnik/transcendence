COMPOSE = docker compose

# URL opened by Chrome dev instance (override: make dev CHROME_URL=…)
CHROME_URL ?= https://localhost:8443

.PHONY: all dev build \
        docker-down docker-clean \
        setup check-cert chrome-dev reset-db \
        install-prek prek-update prek clean

# ── Default: Docker build + run (foreground) ──────────────────

all: setup
	@echo "🚀 Building and starting Docker containers..."
	@$(COMPOSE) up --build

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
		if ! command -v mkcert >/dev/null 2>&1; then \
			echo "❌ mkcert is required but not installed."; \
			echo "   Install it: https://github.com/FiloSottile/mkcert"; \
			exit 1; \
		fi; \
		mkdir -p backend/certs; \
		mkcert -install > /dev/null 2>&1; \
		mkcert -key-file backend/certs/key.pem -cert-file backend/certs/cert.pem \
			ip6-localhost ip6-loopback localhost 127.0.0.1 0.0.0.0 "::1" "::" > /dev/null 2>&1; \
		echo "✅ Generated mkcert TLS certificate in backend/certs/."; \
	fi

check-cert:
	@if [ ! -f backend/certs/cert.pem ]; then \
		echo "⚠️  WARNING: No certificate found at backend/certs/cert.pem. Run 'make setup'."; \
		exit 0; \
	fi; \
	IS_MKCERT=$$(openssl x509 -in backend/certs/cert.pem -noout -issuer 2>/dev/null | grep -ci "mkcert"); \
	if [ "$$IS_MKCERT" -eq 0 ]; then \
		echo "⚠️  WARNING: backend/certs/cert.pem is not a mkcert certificate."; \
		echo "   Browsers will not trust it. Run: rm backend/certs/cert.pem && make setup"; \
	else \
		TRUSTED=0; \
		case "$$(uname)" in \
			Linux) \
				certutil -d sql:$$HOME/.pki/nssdb -L 2>/dev/null | grep -qi "mkcert" && TRUSTED=1 ;; \
			Darwin) \
				security find-certificate -a -c "mkcert" /Library/Keychains/System.keychain 2>/dev/null \
					| grep -q "mkcert" && TRUSTED=1 ;; \
		esac; \
		if [ "$$TRUSTED" -eq 0 ]; then \
			echo "⚠️  WARNING: mkcert CA is not installed in the system trust store."; \
			echo "   Browsers will not trust the certificate. Run: mkcert -install"; \
		else \
			echo "✅ Certificate is a valid mkcert certificate and the CA is trusted."; \
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
	@echo "🧹 Resetting database volume..."
	@$(COMPOSE) down
	@docker volume rm $$(docker volume ls -q --filter "name=db-data") 2>/dev/null || true

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
