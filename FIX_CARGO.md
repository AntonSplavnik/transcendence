# Fix Cargo Cache Issue

Your cargo registry has a corrupted `jsonwebtoken-10.2.0` package that requires Rust Edition 2024 (nightly).

## Quick Fix (Choose One)

### Option 1: Update Rust (Recommended)
```bash
rustup update stable
cd backend
cargo build
```

### Option 2: Clean Everything
```bash
# Clean cargo cache
rm -rf ~/.cargo/registry/cache
rm -rf ~/.cargo/registry/src

# Clean project
cd backend
cargo clean

# Rebuild
cargo build
```

### Option 3: Use Older jsonwebtoken
Already done in `Cargo.toml`:
```toml
jsonwebtoken = { version = "9", features = ["use_pem"] }
```

Then:
```bash
cd backend
cargo update
cargo build
```

### Option 4: Use Nightly Rust
```bash
rustup install nightly
cd backend
rustup override set nightly
cargo build
```

## Verify C++ Works (Already Tested ✅)

```bash
cd backend
./test_cpp_build.sh
```

Output:
```
✅ C++ bindings compiled successfully!
```

## After Cargo Builds

Start the server:
```bash
cd backend
cargo run --release
```

You should see:
```
Game engine started
🚀 Server Listening on https://127.0.0.1:8080/
```

## Test the Game

### 1. Test Standalone C++ Engine
```bash
cd ../game_engine
./game_server
```

### 2. Test API Endpoints
```bash
# Join game
curl -X POST https://localhost:8080/api/game/join \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "name": "Player1"}' -k

# Get status
curl https://localhost:8080/api/game/status -k
```

### 3. Test with Client
```bash
cd ../game_engine/client_example
npm install
npm run dev
# Open http://localhost:5173/
```

## Still Having Issues?

Check:
1. Rust version: `rustc --version` (should be 1.70+)
2. Cargo version: `cargo --version`
3. C++ compiler: `g++ --version`

## Alternative: Skip Game Engine for Now

If you want to get the rest of the backend running:

1. Comment out in `backend/src/main.rs`:
```rust
// mod game;
// let game_manager = ...
// game_manager.clone().start().await;
// tokio::spawn(...);
```

2. Comment out in `backend/src/routers.rs`:
```rust
// crate::game::router(game_manager),
```

3. Comment out in `backend/Cargo.toml`:
```toml
# [build-dependencies]
# cc = "1.0"
```

4. Remove `backend/build.rs`

Then `cargo build` will work without the game engine.

## Expected Build Time

Once cargo cache is fixed:
- First build: ~5-10 minutes (compiling all dependencies)
- C++ compilation: ~5 seconds
- Subsequent builds: ~10 seconds

## Success Indicators

When everything works:
```
Compiling transcendence-backend v0.1.1
    Finished `release` profile [optimized] target(s) in X.XXs
```

Then run:
```bash
cargo run --release
```

Output:
```
Game engine started ✅
🚀 Server Listening on https://127.0.0.1:8080/ ✅
```

You're done! 🎉
