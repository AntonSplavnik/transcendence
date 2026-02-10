# Integration Guide: C++ Game Engine + Rust Backend

This guide explains how to integrate the C++ ArenaGame engine with your existing Rust backend and StreamManager.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Rust Backend (backend/src/)                                    │
│                                                                  │
│  ┌────────────────┐      ┌─────────────────┐                   │
│  │  REST API      │      │  StreamManager  │                   │
│  │  (Axum)        │      │  (WebTransport) │                   │
│  │                │      │                 │                   │
│  │  /game/join ───┼──┐   │  Per-player     │                   │
│  │  /game/leave   │  │   │  connections    │                   │
│  └────────────────┘  │   └────────┬────────┘                   │
│                      │            │                             │
│                      ▼            ▼                             │
│  ┌──────────────────────────────────────────┐                  │
│  │  GameManager (Rust wrapper)              │                  │
│  │  ├─ Owns ArenaGame instance (C++)        │◀── FFI          │
│  │  ├─ Spawns game loop thread              │                  │
│  │  ├─ Receives input from clients          │                  │
│  │  └─ Broadcasts snapshots via StreamMgr   │                  │
│  └──────────────────┬───────────────────────┘                  │
│                     │ C FFI                                     │
└─────────────────────┼───────────────────────────────────────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │  libgame.a (C++)     │
           │  ├─ ArenaGame        │
           │  ├─ Character        │
           │  └─ Physics          │
           └──────────────────────┘
```

## Step 1: Build C++ as Static Library

### Create build.rs for Rust

```rust
// backend/build.rs
use std::env;
use std::path::PathBuf;

fn main() {
    // Compile C++ code
    cc::Build::new()
        .cpp(true)
        .file("../game_engine/src/game_bindings.cpp")
        .include("../game_engine/include")
        .flag("-std=c++17")
        .compile("game");

    // Tell cargo to link the library
    println!("cargo:rustc-link-lib=static=game");
    println!("cargo:rerun-if-changed=../game_engine/");
}
```

### Update Cargo.toml

```toml
[build-dependencies]
cc = "1.0"

[dependencies]
# ... existing dependencies
```

## Step 2: Create C FFI Bindings

### C++ Side: game_bindings.cpp

```cpp
// game_engine/src/game_bindings.cpp
#include "../include/ArenaGame.hpp"
#include <cstring>

using namespace ArenaGame;

// Opaque pointer type for Rust
typedef ArenaGame* GameHandle;

extern "C" {
    // Create/destroy game
    GameHandle game_create() {
        return new ArenaGame();
    }

    void game_destroy(GameHandle game) {
        delete game;
    }

    void game_start(GameHandle game) {
        game->start();
    }

    void game_stop(GameHandle game) {
        game->stop();
    }

    void game_update(GameHandle game) {
        game->update();
    }

    // Player management
    bool game_add_player(GameHandle game, uint32_t player_id, const char* name) {
        return game->addPlayer(player_id, std::string(name));
    }

    bool game_remove_player(GameHandle game, uint32_t player_id) {
        return game->removePlayer(player_id);
    }

    // Input handling
    void game_set_input(
        GameHandle game,
        uint32_t player_id,
        float move_x, float move_y, float move_z,
        bool attacking, bool jumping,
        bool ability1, bool ability2,
        float look_x, float look_y, float look_z
    ) {
        InputState input;
        input.movementDirection = Vector3D(move_x, move_y, move_z);
        input.isAttacking = attacking;
        input.isJumping = jumping;
        input.isUsingAbility1 = ability1;
        input.isUsingAbility2 = ability2;
        input.lookDirection = Vector3D(look_x, look_y, look_z);
        game->setPlayerInput(player_id, input);
    }

    // Snapshot retrieval (simplified - real version would serialize to CBOR)
    struct CCharacterSnapshot {
        uint32_t player_id;
        float pos_x, pos_y, pos_z;
        float vel_x, vel_y, vel_z;
        float yaw;
        uint8_t state;
        float health;
        float max_health;
    };

    struct CGameStateSnapshot {
        uint64_t frame_number;
        double timestamp;
        size_t character_count;
        CCharacterSnapshot characters[32]; // Max 32 players
    };

    void game_get_snapshot(GameHandle game, CGameStateSnapshot* out_snapshot) {
        GameStateSnapshot snapshot = game->createSnapshot();

        out_snapshot->frame_number = snapshot.frameNumber;
        out_snapshot->timestamp = snapshot.timestamp;
        out_snapshot->character_count = snapshot.characters.size();

        for (size_t i = 0; i < snapshot.characters.size() && i < 32; ++i) {
            const auto& src = snapshot.characters[i];
            auto& dst = out_snapshot->characters[i];

            dst.player_id = src.playerID;
            dst.pos_x = src.position.x;
            dst.pos_y = src.position.y;
            dst.pos_z = src.position.z;
            dst.vel_x = src.velocity.x;
            dst.vel_y = src.velocity.y;
            dst.vel_z = src.velocity.z;
            dst.yaw = src.yaw;
            dst.state = static_cast<uint8_t>(src.state);
            dst.health = src.health;
            dst.max_health = src.maxHealth;
        }
    }
}
```

## Step 3: Rust Bindings

### Create game module: backend/src/game/mod.rs

```rust
// backend/src/game/mod.rs
use std::ffi::{CString, c_void};
use serde::{Serialize, Deserialize};

// FFI declarations
type GameHandle = *mut c_void;

#[repr(C)]
struct CCharacterSnapshot {
    player_id: u32,
    pos_x: f32, pos_y: f32, pos_z: f32,
    vel_x: f32, vel_y: f32, vel_z: f32,
    yaw: f32,
    state: u8,
    health: f32,
    max_health: f32,
}

#[repr(C)]
struct CGameStateSnapshot {
    frame_number: u64,
    timestamp: f64,
    character_count: usize,
    characters: [CCharacterSnapshot; 32],
}

extern "C" {
    fn game_create() -> GameHandle;
    fn game_destroy(game: GameHandle);
    fn game_start(game: GameHandle);
    fn game_stop(game: GameHandle);
    fn game_update(game: GameHandle);
    fn game_add_player(game: GameHandle, player_id: u32, name: *const i8) -> bool;
    fn game_remove_player(game: GameHandle, player_id: u32) -> bool;
    fn game_set_input(
        game: GameHandle,
        player_id: u32,
        move_x: f32, move_y: f32, move_z: f32,
        attacking: bool, jumping: bool,
        ability1: bool, ability2: bool,
        look_x: f32, look_y: f32, look_z: f32,
    );
    fn game_get_snapshot(game: GameHandle, out_snapshot: *mut CGameStateSnapshot);
}

// Rust-friendly types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vector3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterSnapshot {
    pub player_id: u32,
    pub position: Vector3D,
    pub velocity: Vector3D,
    pub yaw: f32,
    pub state: u8,
    pub health: f32,
    pub max_health: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameStateSnapshot {
    pub frame_number: u64,
    pub timestamp: f64,
    pub characters: Vec<CharacterSnapshot>,
}

// Safe Rust wrapper
pub struct Game {
    handle: GameHandle,
}

impl Game {
    pub fn new() -> Self {
        let handle = unsafe { game_create() };
        Self { handle }
    }

    pub fn start(&mut self) {
        unsafe { game_start(self.handle) }
    }

    pub fn stop(&mut self) {
        unsafe { game_stop(self.handle) }
    }

    pub fn update(&mut self) {
        unsafe { game_update(self.handle) }
    }

    pub fn add_player(&mut self, player_id: u32, name: &str) -> bool {
        let c_name = CString::new(name).unwrap();
        unsafe { game_add_player(self.handle, player_id, c_name.as_ptr()) }
    }

    pub fn remove_player(&mut self, player_id: u32) -> bool {
        unsafe { game_remove_player(self.handle, player_id) }
    }

    pub fn set_input(
        &mut self,
        player_id: u32,
        move_dir: Vector3D,
        look_dir: Vector3D,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
    ) {
        unsafe {
            game_set_input(
                self.handle,
                player_id,
                move_dir.x, move_dir.y, move_dir.z,
                attacking, jumping,
                ability1, ability2,
                look_dir.x, look_dir.y, look_dir.z,
            )
        }
    }

    pub fn get_snapshot(&self) -> GameStateSnapshot {
        let mut c_snapshot = std::mem::MaybeUninit::<CGameStateSnapshot>::uninit();

        unsafe {
            game_get_snapshot(self.handle, c_snapshot.as_mut_ptr());
            let c_snapshot = c_snapshot.assume_init();

            let characters = (0..c_snapshot.character_count)
                .map(|i| {
                    let c = &c_snapshot.characters[i];
                    CharacterSnapshot {
                        player_id: c.player_id,
                        position: Vector3D {
                            x: c.pos_x,
                            y: c.pos_y,
                            z: c.pos_z,
                        },
                        velocity: Vector3D {
                            x: c.vel_x,
                            y: c.vel_y,
                            z: c.vel_z,
                        },
                        yaw: c.yaw,
                        state: c.state,
                        health: c.health,
                        max_health: c.max_health,
                    }
                })
                .collect();

            GameStateSnapshot {
                frame_number: c_snapshot.frame_number,
                timestamp: c_snapshot.timestamp,
                characters,
            }
        }
    }
}

impl Drop for Game {
    fn drop(&mut self) {
        unsafe { game_destroy(self.handle) }
    }
}

// Thread-safe because C++ engine handles its own synchronization
unsafe impl Send for Game {}
```

## Step 4: GameManager (Rust)

### backend/src/game/manager.rs

```rust
use super::{Game, GameStateSnapshot, Vector3D};
use crate::stream::StreamManager;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time;

pub struct GameManager {
    game: Arc<RwLock<Game>>,
    stream_manager: Arc<StreamManager>,
}

impl GameManager {
    pub fn new(stream_manager: Arc<StreamManager>) -> Self {
        let game = Arc::new(RwLock::new(Game::new()));

        Self {
            game,
            stream_manager,
        }
    }

    pub async fn start(&self) {
        let mut game = self.game.write().await;
        game.start();
    }

    pub async fn add_player(&self, player_id: u32, name: &str) -> bool {
        let mut game = self.game.write().await;
        game.add_player(player_id, name)
    }

    pub async fn remove_player(&self, player_id: u32) -> bool {
        let mut game = self.game.write().await;
        game.remove_player(player_id)
    }

    pub async fn set_input(
        &self,
        player_id: u32,
        move_dir: Vector3D,
        look_dir: Vector3D,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
    ) {
        let mut game = self.game.write().await;
        game.set_input(player_id, move_dir, look_dir, attacking, jumping, ability1, ability2);
    }

    // Main game loop - runs in background task
    pub async fn run_game_loop(self: Arc<Self>) {
        let mut interval = time::interval(Duration::from_millis(1)); // Run as fast as possible

        loop {
            // Update physics (C++ handles fixed timestep internally)
            {
                let mut game = self.game.write().await;
                game.update();
            }

            // Every 50ms, broadcast snapshot (20 Hz)
            if interval.tick().await.elapsed().as_millis() >= 50 {
                let snapshot = {
                    let game = self.game.read().await;
                    game.get_snapshot()
                };

                // Serialize to CBOR
                let snapshot_bytes = ciborium::ser::into_writer(&snapshot, Vec::new())
                    .expect("Failed to serialize snapshot");

                // Broadcast to all connected players
                for character in &snapshot.characters {
                    if let Some(stream) = self.stream_manager
                        .request_stream(character.player_id as u64)
                        .await
                    {
                        let _ = stream.send(&snapshot_bytes).await;
                    }
                }
            }

            // Small sleep to avoid busy-waiting
            tokio::time::sleep(Duration::from_micros(100)).await;
        }
    }
}
```

## Step 5: REST API Integration

### backend/src/routers/game.rs

```rust
use axum::{
    extract::State,
    http::StatusCode,
    routing::{post, get},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::game::{GameManager, Vector3D};

#[derive(Clone)]
struct AppState {
    game_manager: Arc<GameManager>,
}

#[derive(Deserialize)]
struct JoinGameRequest {
    player_id: u32,
    name: String,
}

#[derive(Deserialize)]
struct InputRequest {
    player_id: u32,
    movement: Vector3D,
    look_direction: Vector3D,
    attacking: bool,
    jumping: bool,
    ability1: bool,
    ability2: bool,
}

pub fn router(game_manager: Arc<GameManager>) -> Router {
    Router::new()
        .route("/join", post(join_game))
        .route("/leave", post(leave_game))
        .route("/input", post(handle_input))
        .with_state(AppState { game_manager })
}

async fn join_game(
    State(state): State<AppState>,
    Json(req): Json<JoinGameRequest>,
) -> Result<StatusCode, StatusCode> {
    let success = state.game_manager.add_player(req.player_id, &req.name).await;

    if success {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

async fn leave_game(
    State(state): State<AppState>,
    Json(player_id): Json<u32>,
) -> StatusCode {
    state.game_manager.remove_player(player_id).await;
    StatusCode::OK
}

async fn handle_input(
    State(state): State<AppState>,
    Json(input): Json<InputRequest>,
) -> StatusCode {
    state.game_manager.set_input(
        input.player_id,
        input.movement,
        input.look_direction,
        input.attacking,
        input.jumping,
        input.ability1,
        input.ability2,
    ).await;

    StatusCode::OK
}
```

## Step 6: Main Integration

### backend/src/main.rs

```rust
mod game;

use game::{GameManager};
use stream::StreamManager;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    // Initialize stream manager
    let stream_manager = Arc::new(StreamManager::new());

    // Initialize game manager
    let game_manager = Arc::new(GameManager::new(stream_manager.clone()));

    // Start game loop in background
    game_manager.clone().start().await;
    tokio::spawn(async move {
        game_manager.run_game_loop().await;
    });

    // Start web server
    let app = Router::new()
        .nest("/api/game", game::router(game_manager.clone()))
        .nest("/api/auth", auth::router())
        // ... other routes
        ;

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

## Testing

### 1. Build

```bash
cd backend
cargo build --release
```

### 2. Run Server

```bash
cargo run --release
```

### 3. Test with curl

```bash
# Join game
curl -X POST http://localhost:8080/api/game/join \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "name": "TestPlayer"}'

# Send input
curl -X POST http://localhost:8080/api/game/input \
  -H "Content-Type: application/json" \
  -d '{
    "player_id": 1,
    "movement": {"x": 0, "y": 0, "z": 1},
    "look_direction": {"x": 0, "y": 0, "z": 1},
    "attacking": false,
    "jumping": false,
    "ability1": false,
    "ability2": false
  }'
```

### 4. Connect Client

Open `game_engine/client_example/index.html` in browser and connect to `ws://localhost:8080/game`.

## Troubleshooting

### Linker errors

```bash
# Make sure C++ standard library is linked
# Add to build.rs:
println!("cargo:rustc-link-lib=stdc++");
```

### Segmentation faults

- Check that GameHandle is valid before use
- Ensure strings are null-terminated for C FFI
- Verify memory alignment for structs

### Performance issues

- Run game loop in separate thread/task
- Profile with `perf` or `cargo flamegraph`
- Check that fixed timestep isn't accumulating

## Next Steps

1. Implement CBOR serialization for snapshots
2. Add compression to StreamManager
3. Implement reconnection logic
4. Add server-side input validation (anti-cheat)
5. Metrics and monitoring
