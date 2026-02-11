# Game Server: WebTransport Stream Refactoring Plan

## Goal
Replace REST API endpoints for game input with bidirectional WebTransport streams for real-time, low-latency communication.

## Current Architecture (Problems)

**Input Flow**: Client → REST POST /game/input → Server
- HTTP request/response overhead (~10-50ms latency)
- Unnecessary headers on every input packet
- Doesn't match real-time nature of game input

**Output Flow**: Server → WebTransport stream → Client
- Game state snapshots at 20 Hz (50ms intervals)
- Currently creates a NEW stream on every broadcast and ignores the receiver

## Target Architecture (Solution)

**Bidirectional WebTransport Stream Per Player**:
```
Client ──[Input Messages]──▶ Server
       ◀──[State Snapshots]── Server
```

**Benefits**:
- 5-10x lower latency for input (1-5ms vs 10-50ms)
- Single persistent connection per player
- Natural message framing with CBOR codec
- Automatic compression for large messages (>1KB)
- Proper error handling and connection lifecycle

---

## Implementation Steps

### Step 1: Define Message Types
**File**: `backend/src/game/messages.rs` (new file)

Create typed message enums for client-server communication:

```rust
use serde::{Deserialize, Serialize};
use crate::game::ffi::{GameStateSnapshot, Vector3D};

/// Messages sent FROM server TO client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GameServerMessage {
    /// Full game state snapshot (sent at 20 Hz)
    Snapshot(GameStateSnapshot),

    /// Player successfully joined
    PlayerJoined {
        player_id: u32,
        name: String,
    },

    /// Another player left
    PlayerLeft {
        player_id: u32,
    },

    /// Error occurred
    Error {
        message: String,
    },
}

/// Messages sent FROM client TO server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GameClientMessage {
    /// Player input for current frame
    Input {
        movement: Vector3D,
        look_direction: Vector3D,
        #[serde(default)]
        attacking: bool,
        #[serde(default)]
        jumping: bool,
        #[serde(default)]
        ability1: bool,
        #[serde(default)]
        ability2: bool,
        #[serde(default)]
        dodging: bool,
    },

    /// Register a hit (client-authoritative for now)
    RegisterHit {
        victim_id: u32,
        damage: f32,
    },

    /// Player is leaving
    Leave,
}
```

**Rationale**: Using `#[serde(tag = "type")]` creates tagged unions for easy debugging and extensibility.

---

### Step 2: Add Stream Handler
**File**: `backend/src/game/stream_handler.rs` (new file)

Create a dedicated handler for player game sessions:

```rust
use crate::prelude::*;
use crate::stream::{StreamManager, Sender, Receiver, SinkExt, StreamExt};
use std::sync::Arc;
use super::{GameManager, GameServerMessage, GameClientMessage};

/// Handle a single player's game stream session
///
/// This function:
/// 1. Opens a bidirectional stream with the client
/// 2. Sends initial snapshot
/// 3. Listens for incoming input messages
/// 4. Processes input and updates game state
/// 5. Cleans up when stream closes
pub async fn handle_player_stream(
    user_id: i32,
    player_id: u32,
    name: String,
    game_manager: Arc<GameManager>,
) -> Result<(), anyhow::Error> {
    tracing::info!("Starting game stream for player {} (user_id: {})", player_id, user_id);

    // Request bidirectional stream
    let stream_manager = StreamManager::global();
    let (mut sender, mut receiver) = stream_manager
        .request_stream::<GameServerMessage, GameClientMessage>(
            user_id,
            crate::stream::StreamType::Game
        )
        .await
        .map_err(|e| anyhow::anyhow!("Failed to open stream: {}", e))?;

    // Send initial welcome snapshot
    let snapshot = game_manager.get_snapshot().await;
    sender.send(GameServerMessage::Snapshot(snapshot)).await?;
    sender.flush().await?;

    // Store sender for broadcast (we'll modify game loop to use stored senders)
    // TODO: Store sender in GameManager for snapshot broadcasts

    // Process incoming messages from client
    while let Some(result) = receiver.next().await {
        match result {
            Ok(GameClientMessage::Input {
                movement,
                look_direction,
                attacking,
                jumping,
                ability1,
                ability2,
                dodging,
            }) => {
                // Update player input in game state
                game_manager.set_input(
                    player_id,
                    movement,
                    look_direction,
                    attacking,
                    jumping,
                    ability1,
                    ability2,
                    dodging,
                ).await;
            }

            Ok(GameClientMessage::RegisterHit { victim_id, damage }) => {
                // Process hit registration
                game_manager.register_hit(player_id, victim_id, damage).await;
            }

            Ok(GameClientMessage::Leave) => {
                tracing::info!("Player {} requested leave", player_id);
                break;
            }

            Err(e) => {
                tracing::warn!("Stream error for player {}: {}", player_id, e);
                break;
            }
        }
    }

    // Cleanup when stream ends
    tracing::info!("Removing player {} from game", player_id);
    game_manager.remove_player(player_id).await;

    Ok(())
}
```

---

### Step 3: Modify GameManager to Store Stream Senders
**File**: `backend/src/game/manager.rs`

**Changes needed**:

1. Add field to store player stream senders:
```rust
use std::collections::HashMap;
use crate::stream::Sender;
use super::GameServerMessage;

pub struct GameManager {
    game: Arc<RwLock<Game>>,
    // Map of player_id -> stream sender for broadcasting snapshots
    player_streams: Arc<RwLock<HashMap<u32, Sender<GameServerMessage>>>>,
}
```

2. Add methods to manage streams:
```rust
impl GameManager {
    pub async fn add_player_stream(
        &self,
        player_id: u32,
        sender: Sender<GameServerMessage>,
    ) {
        let mut streams = self.player_streams.write().await;
        streams.insert(player_id, sender);
    }

    pub async fn remove_player_stream(&self, player_id: u32) {
        let mut streams = self.player_streams.write().await;
        streams.remove(&player_id);
    }
}
```

3. Modify game loop to use stored senders (lines 117-144):
```rust
// Broadcast snapshots at 20 Hz
_ = snapshot_interval.tick() => {
    let snapshot = {
        let game = self.game.read().await;
        game.get_snapshot()
    };

    let server_msg = GameServerMessage::Snapshot(snapshot);

    // Broadcast to all players with active streams
    let mut streams = self.player_streams.write().await;
    let mut disconnected = Vec::new();

    for (player_id, sender) in streams.iter_mut() {
        if let Err(e) = sender.send(server_msg.clone()).await {
            error!("Failed to send snapshot to player {}: {}", player_id, e);
            disconnected.push(*player_id);
        }
    }

    // Remove disconnected players
    for player_id in disconnected {
        streams.remove(&player_id);
        // Also remove from game state
        let mut game = self.game.write().await;
        game.remove_player(player_id);
    }
}
```

**Rationale**: Store senders to avoid creating new streams on every broadcast. Track disconnections to clean up automatically.

---

### Step 4: Update Router with Stream Endpoint
**File**: `backend/src/game/router.rs`

**Replace** the `/game/input` endpoint with a new `/game/join_stream` endpoint:

```rust
#[derive(Debug, Deserialize, ToSchema)]
pub struct JoinStreamRequest {
    pub name: String,
}

#[endpoint]
async fn join_stream(
    req: JsonBody<JoinStreamRequest>,
    depot: &mut Depot,
) -> Result<StatusCode, StatusError> {
    let user_id: i32 = depot.user_id(); // Assumes auth middleware sets this
    let game_manager = depot.get::<Arc<GameManager>>("game_manager").unwrap();
    let req = req.into_inner();

    // Assign player_id (use user_id as player_id for simplicity, or generate)
    let player_id = user_id as u32;

    // Add player to game
    let success = game_manager.add_player(player_id, &req.name).await;
    if !success {
        return Err(StatusError::bad_request()
            .with_detail("Failed to join game (full or already joined)"));
    }

    // Spawn background task to handle the stream
    tokio::spawn({
        let gm = game_manager.clone();
        let name = req.name.clone();
        async move {
            if let Err(e) = super::stream_handler::handle_player_stream(
                user_id,
                player_id,
                name,
                gm
            ).await {
                tracing::error!(
                    "Game stream handler error for player {}: {}",
                    player_id,
                    e
                );
            }
        }
    });

    Ok(StatusCode::OK)
}
```

**Update router**:
```rust
pub fn router(gm: Arc<GameManager>) -> Router {
    Router::with_path("game")
        .hoop(GameManagerHoop(gm))
        .push(Router::with_path("join_stream").post(join_stream))
        .push(Router::with_path("status").get(get_status))
        .push(Router::with_path("snapshot").get(get_snapshot)) // Keep for debugging
        // REMOVED: .push(Router::with_path("input").post(handle_input))
        // REMOVED: .push(Router::with_path("join").post(join_game))
        // REMOVED: .push(Router::with_path("leave").post(leave_game))
        // REMOVED: .push(Router::with_path("hit").post(register_hit))
}
```

**Rationale**: Single endpoint to join and establish stream. Old endpoints removed since all I/O is now on the stream.

---

### Step 5: Update Module Exports
**File**: `backend/src/game/mod.rs`

```rust
mod ffi;
mod manager;
mod messages;      // NEW
mod router;
mod stream_handler; // NEW

pub use ffi::{Game, GameStateSnapshot, CharacterSnapshot, Vector3D};
pub use manager::GameManager;
pub use messages::{GameServerMessage, GameClientMessage}; // NEW
pub use router::router;
```

---

## API Flow Comparison

### Before (REST)
```
1. Client: POST /game/join {"player_id": 1, "name": "Alice"}
2. Server: 200 OK {"success": true}
3. Loop:
   - Client: POST /game/input {movement, attacking, ...}
   - Server: 200 OK
   - Server: WebTransport stream → snapshot (ignores receiver)
4. Client: POST /game/leave {"player_id": 1}
```

### After (WebTransport)
```
1. Client: POST /game/join_stream {"name": "Alice"}
2. Server: Spawns stream handler task, returns 200 OK
3. Server: Opens WebTransport stream
4. Server → Client: Welcome snapshot
5. Loop (bidirectional):
   - Client → Server: Input messages
   - Server → Client: Snapshot messages (20 Hz)
6. Client → Server: Leave message (stream closes)
```

---

## Edge Cases & Error Handling

### Connection Loss
- **Current behavior**: Heartbeat stream detects disconnect, handler exits
- **New behavior**: When handler exits, `remove_player()` is called automatically
- **No changes needed**: StreamManager already handles cleanup

### Player Reconnection
- **Issue**: Same user connects while already in game
- **Solution**: StreamManager replaces old connection automatically (connection_id tracking)
- **Result**: Old stream errors out, new stream takes over
- **Game state**: Call `remove_player()` in old handler, `add_player()` in new handler

### Stream Send Errors
- **Current**: Logged but ignored
- **New**: Track failed sends in game loop, remove disconnected players
- **Implementation**: See Step 3 modified game loop

### Multiple Tabs/Devices
- **Behavior**: Only one connection per user_id (last connection wins)
- **No changes needed**: This is by design in StreamManager

---

## Testing Plan

### Unit Tests
1. Message serialization/deserialization
2. GameManager stream management (add/remove)

### Integration Tests
1. Join stream endpoint
2. Bidirectional message flow
3. Disconnect handling
4. Snapshot broadcast to multiple players

### Manual Testing
1. Single player: join, move, attack, leave
2. Two players: join, interact, one disconnects
3. Reconnection: join, disconnect, rejoin
4. Performance: measure input latency vs old REST approach

---

## Migration Strategy

### Phase 1: Parallel Operation (Optional)
- Keep both REST and stream endpoints
- Add feature flag to switch between them
- Test thoroughly with stream version

### Phase 2: Stream Only (Recommended)
- Remove REST input endpoints entirely
- Simpler codebase
- Forces clients to use low-latency path

**Recommendation**: Go directly to Phase 2 since this is early development.

---

## Files to Create
1. `backend/src/game/messages.rs` - Message type definitions
2. `backend/src/game/stream_handler.rs` - Stream session handler

## Files to Modify
1. `backend/src/game/manager.rs` - Add stream storage and modified game loop
2. `backend/src/game/router.rs` - Replace REST endpoints with join_stream
3. `backend/src/game/mod.rs` - Add new module exports

## Files to Delete (Optional)
- Can remove old request/response types from router.rs if no longer needed

---

## Estimated Complexity
- **Low**: Message definitions, stream handler
- **Medium**: GameManager modifications (stream storage)
- **Low-Medium**: Router updates

**Total effort**: ~2-3 hours for implementation + testing

---

## Rollback Plan
If issues arise:
1. Git revert to previous commit
2. Or: Re-add REST endpoints temporarily
3. Debug stream issues separately

---

## Future Enhancements (Out of Scope)
1. **Flow control**: Track client acknowledgments to avoid overwhelming slow clients
2. **Compression tuning**: Adjust COMPRESS_THRESHOLD based on game state size
3. **Delta compression**: Send only changed state instead of full snapshots
4. **Unreliable datagrams**: Use QUIC datagrams for non-critical state (positions) vs streams for critical events (hits, deaths)
5. **Server-side input validation**: Currently trusts client input, should validate movement bounds, cooldowns, etc.
