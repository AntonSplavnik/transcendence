all:
	@cd frontend && npm install && npm run build
	@cd backend && cargo build --release

# run npm run dev and cargo run, with terminal focused on backend
dev:
	@cd frontend && npm install && npm run dev & \
		cd backend && cargo run
