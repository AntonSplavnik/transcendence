# WebTransport Stream Flow Analysis for /game

## Current Implementation Flow

### 1. Initial WebTransport Connection (One-time setup)

**Client Side:**
```javascript
// 1. Establish WebTransport connection
const wt = new WebTransport("https://localhost:8443/api/stream/connect");
await wt.ready;

// 2. Receive control stream with pending key
const controlStream = await wt.incomingBidirectionalStreams.getReader().read();
const reader = controlStream.value.readable.getReader();
const {value} = await reader.read();
const pendingKey = decodeCBOR(value); // StreamType::Ctrl(PendingConnectionKey)

// 3. Authenticate the connection via REST
await fetch("/api/stream/bind", {
    method: "POST",
    credentials: "include", // Send session cookies
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(pendingKey)
});
```

**Server Side:**
```
Route: CONNECT /api/stream/connect
Handler: connect_stream() in stream_manager.rs

Flow:
1. Client connects → WebTransport session created
2. Server creates PendingConnectionKey
3. Server opens control stream
4. Server sends StreamType::Ctrl(key) to client
5. Server waits for bind call (timeout: 30s)

Route: POST /api/stream/bind (requires authentication)
Handler: bind_pending_stream() in stream_manager.rs

Flow:
1. Validates user session from cookies
2. Looks up pending connection by key
3. Sends session to waiting connect_stream handler
4. Connection is now registered: user_id → ConnectionEntry
```

**Result:** WebTransport connection is established and authenticated for the user.

---

### 2. Join Game and Establish Game Stream

**Client Side:**
```javascript
// 1. Request to join game (uses authenticated session)
await fetch("/api/game/join_stream", {
    method: "POST",
    credentials: "include",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({name: "Alice"})
});

// 2. Wait for server to open game stream
const gameStreamResult = await wt.incomingBidirectionalStreams.getReader().read();
const gameStream = gameStreamResult.value;

// 3. Setup reader for game state snapshots
const snapshotReader = gameStream.readable.pipeThrough(/* CBOR decoder */).getReader();

// 4. Setup writer for input messages
const inputWriter = gameStream.writable.pipeThrough(/* CBOR encoder */).getWriter();
```

**Server Side:**
```
Route: POST /api/game/join_stream (requires authentication)
Handler: join_stream() in game/router.rs

Flow:
1. Extract user_id from depot (set by auth middleware from JWT)
2. Use user_id as player_id
3. Add player to game: game_manager.add_player(player_id, name)
4. Spawn background task: handle_player_stream()
5. Return 200 OK immediately

Background Task: handle_player_stream()
Location: game/stream_handler.rs

Flow:
1. Call StreamManager::request_stream(user_id, StreamType::Game)

   StreamManager internals:
   a. Looks up user's ConnectionEntry in registry
   b. Sends OpenBidiStream command to connection handler
   c. Connection handler opens new WebTransport bidirectional stream
   d. StreamManager wraps stream with CBOR codec (CompressedCborEncoder/Decoder)
   e. Sends StreamType::Game as first CBOR message (client can identify stream type)
   f. Returns typed Sender<GameServerMessage>, Receiver<GameClientMessage>

2. Send initial game state snapshot via sender
3. Store sender in GameManager: game_manager.add_player_stream(player_id, sender)
4. Listen on receiver for incoming client messages in loop:
   - GameClientMessage::Input → Update game state
   - GameClientMessage::RegisterHit → Process hit
   - GameClientMessage::Leave → Break loop
5. On loop exit: cleanup player from game and streams
```

---

### 3. Game Communication Loop

**Client → Server (Input):**
```javascript
// Send player input
await inputWriter.write({
    type: "Input",
    movement: {x: 0, y: 0, z: 1},
    look_direction: {x: 0, y: 1, z: 0},
    attacking: true,
    jumping: false,
    ability1: false,
    ability2: false,
    dodging: false
});
```

**Server Side:**
```
Stream Handler (handle_player_stream):
1. Receiver gets GameClientMessage::Input
2. Calls game_manager.set_input(player_id, movement, look_direction, ...)
3. Game state updated immediately
```

**Server → Client (Snapshots):**
```
Game Loop (game_manager.run_game_loop):
1. Every 50ms (20 Hz):
   a. Get current game snapshot
   b. Create GameServerMessage::Snapshot(snapshot)
   c. Iterate over player_streams HashMap
   d. Send snapshot to each player's sender
   e. Track and remove disconnected players
```

**Client Side:**
```javascript
// Receive game snapshots
while (true) {
    const {value, done} = await snapshotReader.read();
    if (done) break;

    if (value.type === "Snapshot") {
        // Update game client with new state
        updateGameState(value);
        renderFrame(value);
    }
}
```

---

## Verification: Is the Implementation Correct?

### ✅ Connection Establishment
- WebTransport connection established via `/api/stream/connect`
- Two-step authentication (pending key + bind with session cookies)
- Connection registered in StreamManager: `user_id → ConnectionEntry`

### ✅ Game Stream Creation
- REST endpoint `/api/game/join_stream` initiates the process
- Server calls `StreamManager::request_stream(user_id, StreamType::Game)`
- StreamManager sends command to connection handler
- Connection handler opens NEW bidirectional stream on existing WebTransport session
- Stream is framed with CBOR codec
- First message identifies stream type: `StreamType::Game`

### ✅ Bidirectional Communication
- Client sends `GameClientMessage` → Stream handler receives → Updates game state
- Game loop broadcasts `GameServerMessage::Snapshot` → All players receive updates

### ✅ Lifecycle Management
- Stream handler runs until disconnect or Leave message
- Automatic cleanup of player from game and streams
- Game loop detects send failures and removes disconnected players

---

## Key Insight: Server-Initiated Stream Model

The architecture uses **server-initiated streams** on an existing WebTransport connection:

1. **One WebTransport connection per user** (established once, persists)
2. **Multiple bidirectional streams** can be opened on that connection:
   - Control stream (for pending key)
   - Game stream (for gameplay)
   - Future: Chat stream, notifications stream, etc.
3. **Each stream is identified by StreamType** sent as first CBOR message
4. **Streams are opened by the server** via `StreamManager::request_stream()`
5. **Clients receive streams** via `wt.incomingBidirectionalStreams`

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLIENT                                  │
│                                                                  │
│  1. CONNECT /api/stream/connect                                 │
│     ↓                                                            │
│  2. Receive control stream → PendingConnectionKey               │
│     ↓                                                            │
│  3. POST /api/stream/bind (with cookies + key)                  │
│     ↓                                                            │
│  [WebTransport connection authenticated]                        │
│     ↓                                                            │
│  4. POST /api/game/join_stream {"name": "Alice"}                │
│     ↓                                                            │
│  5. Server opens game stream → client receives it               │
│     ↓                                                            │
│  6. Bidirectional communication:                                │
│     - Send: GameClientMessage::Input                            │
│     - Receive: GameServerMessage::Snapshot (20 Hz)              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              ↕
                    WebTransport/QUIC
                              ↕
┌──────────────────────────────────────────────────────────────────┐
│                          SERVER                                  │
│                                                                  │
│  webtransport_router("/api/stream/connect")                     │
│  ├─ connect_stream()                                            │
│  │  ├─ Create pending key                                       │
│  │  ├─ Open control stream → send StreamType::Ctrl(key)        │
│  │  └─ Wait for bind                                            │
│  │                                                               │
│  router("/api/stream")                                          │
│  └─ POST /bind → bind_pending_stream()                          │
│     └─ Link user_id to WebTransport connection                  │
│                                                                  │
│  router("/api/game")                                            │
│  └─ POST /join_stream → join_stream()                           │
│     ├─ Extract user_id from auth                                │
│     ├─ Add player to game                                       │
│     └─ Spawn handle_player_stream() task                        │
│        ↓                                                         │
│  handle_player_stream()                                         │
│  ├─ StreamManager::request_stream(user_id, Game)                │
│  │  └─ Opens new stream on existing connection                  │
│  ├─ Send initial snapshot                                       │
│  ├─ Store sender in GameManager                                 │
│  └─ Loop: receive input → update game state                     │
│                                                                  │
│  run_game_loop()                                                │
│  ├─ Physics update (2000 Hz)                                    │
│  └─ Broadcast snapshots (20 Hz)                                 │
│     └─ Iterate player_streams → send to each                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Comparison: Your Understanding vs Actual Implementation

**Your Understanding:**
> Frontend does request → stream router gets request → stream creates stream → use in /game

**Actual Implementation:**
> Frontend does REST request (`/api/game/join_stream`) → game router spawns task → task calls `StreamManager::request_stream()` → StreamManager sends command to existing connection handler → connection handler opens stream → use in /game

**Difference:**
- The "stream router" (`/api/stream/connect`) is for **initial connection setup**, not game streams
- Game streams are opened by calling `StreamManager::request_stream()` from **within the game module**
- This is the **server-initiated stream model** - server components request streams on behalf of users

---

## Conclusion: Implementation is CORRECT ✅

The `/game` implementation correctly uses the WebTransport stream architecture:

1. ✅ Relies on existing authenticated WebTransport connection (established via `/api/stream/connect` and `/api/stream/bind`)
2. ✅ Uses REST endpoint `/api/game/join_stream` to initiate game session
3. ✅ Spawns background task that calls `StreamManager::request_stream()` to open game stream
4. ✅ Handles bidirectional communication via typed messages
5. ✅ Stores sender for efficient snapshot broadcasting
6. ✅ Cleans up properly on disconnect

No changes needed! The implementation follows the established pattern correctly.

---

## Next Steps for Client Development

1. Establish WebTransport connection on app load:
   - Connect to `/api/stream/connect`
   - Receive control stream and extract pending key
   - Call `/api/stream/bind` with the key

2. Join game when user clicks "Play":
   - Call `/api/game/join_stream` with player name
   - Wait for incoming bidirectional stream (identified by `StreamType::Game`)
   - Setup CBOR decoder/encoder on the stream

3. Game loop:
   - Send input messages at regular intervals (e.g., 60 Hz)
   - Receive and process snapshots (20 Hz from server)
   - Render game state based on snapshots
   - Apply client-side prediction for smooth movement

4. Cleanup:
   - Send `GameClientMessage::Leave` when exiting game
   - Close stream gracefully
   - WebTransport connection can persist for other features (chat, etc.)
