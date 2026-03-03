BACKEND_BIN = backend/target/release/transcendence-backend
DB_FILE = backend/data/diesel.sqlite
ENV_EXAMPLE = backend/.env.example
ENV_FILE = backend/.env

# Source discovery (finds all relevant files to watch for changes)
FRONTEND_SRC = $(shell find frontend/src frontend/public -type f 2>/dev/null) \
               frontend/package.json frontend/vite.config.ts frontend/index.html
BACKEND_SRC = $(shell find backend/src backend/migrations backend/assets -type f 2>/dev/null) \
              backend/Cargo.toml backend/Cargo.lock

.PHONY: all dev run-opt run setup check-cert chrome-dev reset-db create-db install-prek prek-update prek clean

all: frontend/dist/index.html setup create-db
	@echo "🚀 Running development build with Chrome dev browser..."
	@$(MAKE) chrome-dev &
	@cd backend && cargo run

# 'run' depends on the frontend build output and the DB
run: frontend/dist/index.html setup create-db
	@echo "🚀 Running development build..."
	@cd backend && cargo run

run-opt: $(BACKEND_BIN) setup create-db
	@echo "🚀 Starting optimized backend..."
	@cd backend && ../$(BACKEND_BIN)

build: $(BACKEND_BIN) frontend/dist/index.html

$(BACKEND_BIN): $(BACKEND_SRC)
	@echo "📦 Building backend (release)..."
	@cd backend && cargo build --release

frontend/dist/index.html: $(FRONTEND_SRC)
	@echo "🎨 Building frontend..."
	@cd frontend && npm install && npm run build
	@touch frontend/dist/index.html # Update timestamp to ensure Make knows it's done

# --------------------------

dev: setup create-db
	@echo "🛠️ Starting development environment..."
	@cd frontend && npm install && npm run dev & \
		cd backend && cargo run

setup:
	@echo "⚙️  Setting up environment..."
	@if [ ! -f $(ENV_FILE) ]; then \
		cp $(ENV_EXAMPLE) $(ENV_FILE); \
		echo "✅ Created $(ENV_FILE) from example."; \
	fi
	@if [ ! -f backend/certs/cert.pem ]; then \
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
		"https://localhost:8443" >/dev/null 2>&1 &

create-db:
	@if [ ! -f $(DB_FILE) ]; then \
		$(MAKE) reset-db; \
	fi

reset-db:
	@echo "🧹 Resetting database..."
	@mkdir -p backend/data
	@rm -f $(DB_FILE)*
	@sqlite3 $(DB_FILE) 'VACUUM;'

install-prek:
	@curl --proto '=https' --tlsv1.2 -LsSf https://github.com/j178/prek/releases/download/v0.3.2/prek-installer.sh | sh
	@prek self update
	@prek install --hook-type pre-push

prek-update:
	@prek self update
	@prek install --hook-type pre-push

prek:
	@prek run --all-files --stage manual

clean:
	@echo "🗑️  Cleaning build artifacts..."
	@rm -rf frontend/dist
	@rm -rf frontend/node_modules
	@rm -rf /tmp/chrome-dev-wt
	@cd backend && cargo clean
	@echo "✨ Workspace cleaned."
