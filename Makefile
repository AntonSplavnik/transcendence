BACKEND_BIN = backend/target/release/transcendence-backend
DB_FILE = backend/data/diesel.sqlite
ENV_EXAMPLE = backend/.env.example
ENV_FILE = backend/.env

# Source discovery (finds all relevant files to watch for changes)
FRONTEND_SRC = $(shell find frontend/src frontend/public -type f 2>/dev/null) \
               frontend/package.json frontend/vite.config.ts frontend/index.html
BACKEND_SRC = $(shell find backend/src backend/migrations backend/assets -type f 2>/dev/null) \
              backend/Cargo.toml backend/Cargo.lock

.PHONY: all dev run-opt run setup reset-db create-db install-prek prek-update prek clean

all: run

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
	@cd backend && cargo clean
	@echo "✨ Workspace cleaned."
