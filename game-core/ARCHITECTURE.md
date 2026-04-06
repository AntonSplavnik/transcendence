# Hybrid Architecture: Server Authority + Client Prediction

This document explains how the C++ server-authoritative game engine integrates with Babylon.js client-side prediction.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        SERVER (Rust + C++)                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ArenaGame (C++)                                           │  │
│  │  ├─ Fixed timestep physics (60 FPS)                        │  │
│  │  ├─ Authoritative character positions                      │  │
│  │  ├─ Collision detection & resolution                       │  │
│  │  ├─ Combat processing (damage, attacks)                    │  │
│  │  └─ Generate GameStateSnapshot                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  StreamManager (Rust)                                      │  │
│  │  ├─ Manage WebTransport connections                        │  │
│  │  ├─ Send snapshots @ 20 Hz                                 │  │
│  │  ├─ Receive player input @ 60 Hz                           │  │
│  │  └─ CBOR + Zstd compression                                │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              │
                WebTransport / WebSocket (CBOR)
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    CLIENT (Browser + Babylon.js)                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  GameClient (TypeScript)                                   │  │
│  │  ├─ Babylon.js Havok Physics                               │  │
│  │  ├─ Client-side prediction (60 FPS)                        │  │
│  │  ├─ Apply local input immediately                          │  │
│  │  ├─ Reconcile with server snapshots                        │  │
│  │  └─ Interpolate remote players                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Babylon.js Rendering (60+ FPS)                            │  │
│  │  ├─ 3D character meshes                                    │  │
│  │  ├─ Animation system                                       │  │
│  │  ├─ Particle effects                                       │  │
│  │  └─ Camera controls                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Why This Architecture?

### Server Authority (C++)
- **Security**: Prevents cheating (speed hacks, position manipulation, etc.)
- **Performance**: C++ physics is faster than JavaScript for authoritative simulation
- **Consistency**: All clients see the same game state
- **Determinism**: Fixed timestep ensures reproducible physics

### Client Prediction (Babylon.js)
- **Responsiveness**: Player sees immediate response to input
- **Smoothness**: Interpolation between server snapshots (60 FPS rendering from 20 Hz updates)
- **Visual Quality**: Use Babylon.js for rendering, particles, animations
- **Physics**: Havok physics for client-side prediction and visual effects

## Data Flow

### 1. Input Flow (Client → Server)

```
Player presses W
    ↓
InputState created { movementDirection: (0, 0, 1), ... }
    ↓
Applied to local character prediction (immediate visual feedback)
    ↓
Sent to server via WebTransport @ 60 Hz
    ↓
Server applies input to authoritative character state
```

### 2. Snapshot Flow (Server → Client)

```
Server runs physics tick (60 FPS)
    ↓
Every 3rd frame (20 Hz), create GameStateSnapshot
    ↓
Serialize to CBOR, compress with Zstd
    ↓
Send via WebTransport to all clients
    ↓
Client buffers snapshots (150ms buffer for interpolation)
    ↓
Reconcile local player, interpolate remote players
```

## Client-Side Prediction in Detail

### For Local Player (You)

1. **Input Applied Immediately**
   ```typescript
   // Player presses W
   input.movementDirection = (0, 0, 1)

   // Immediately apply to local character (no lag!)
   character.applyInputPrediction(input, deltaTime)
   character.mesh.position.x += velocity.x * deltaTime
   ```

2. **Server Reconciliation**
   ```typescript
   // Server snapshot arrives 50ms later
   serverPosition = (10.5, 0, 12.3)
   clientPosition = (10.6, 0, 12.4)  // Small difference due to prediction

   // Calculate error
   error = distance(serverPosition, clientPosition)  // = 0.14 units

   if (error < 0.5) {
       // Small error: smooth correction (20% per frame)
       clientPosition = lerp(clientPosition, serverPosition, 0.2)
   } else if (error > 2.0) {
       // Large error: snap to server (probably respawned or teleported)
       clientPosition = serverPosition
   }
   ```

3. **Input Replay**
   ```typescript
   // Store all inputs with frame numbers
   inputHistory = [
       { frame: 100, input: { movementDirection: (0, 0, 1) } },
       { frame: 101, input: { movementDirection: (0, 0, 1) } },
       { frame: 102, input: { movementDirection: (0, 0, 1) } }
   ]

   // Server snapshot is for frame 100
   // Re-apply frames 101 and 102 on top of corrected server position
   // This keeps prediction accurate even after correction
   ```

### For Remote Players (Others)

**Interpolation** (not prediction):
```typescript
// Buffer 3 snapshots (150ms delay)
snapshotBuffer = [
    { time: 1.000, position: (5, 0, 10) },
    { time: 1.050, position: (5, 0, 11) },  // ← Interpolate between these
    { time: 1.100, position: (5, 0, 12) }   // ← And these
]

// Current time: 1.075 (halfway between snapshots)
alpha = (1.075 - 1.050) / (1.100 - 1.050) = 0.5

// Smooth interpolation
displayPosition = lerp(
    (5, 0, 11),  // Old snapshot
    (5, 0, 12),  // New snapshot
    0.5          // Alpha
) = (5, 0, 11.5)
```

**Why delay remote players?**
- Snapshots arrive at 20 Hz (every 50ms)
- Buffering 3 snapshots = 150ms delay
- But movement is perfectly smooth! (interpolated at 60 FPS)
- Trade-off: 150ms delay vs smooth motion

## Physics Differences

### Server (C++)

```cpp
// Simple, deterministic physics
velocity = input.movementDirection * movementSpeed;
position += velocity * deltaTime;

// Ground check
if (position.y <= 0) {
    position.y = 0;
    velocity.y = 0;
    isGrounded = true;
}

// Collision: push apart
if (characterA.collides(characterB)) {
    Vector3 separation = characterB.pos - characterA.pos;
    characterA.pos -= separation * 0.5;
    characterB.pos += separation * 0.5;
}
```

### Client (Babylon.js Havok)

```typescript
// Use Havok physics engine for visual fidelity
physicsAggregate = new PhysicsAggregate(
    mesh,
    PhysicsShapeType.CAPSULE,
    { mass: 1, friction: 0.5 }
)

// Apply forces, not positions
physicsBody.applyForce(forceVector, meshPosition)

// Havok handles:
// - Realistic collisions
// - Ragdoll physics on death
// - Environmental interactions
// - Particles, debris
```

**Note**: Client physics is overridden by server snapshots for gameplay, but used for visual effects.

## Network Optimization

### Snapshot Compression

```
Uncompressed snapshot (8 players):
  PlayerID (4 bytes) + Position (12 bytes) + Velocity (12 bytes)
  + State (1 byte) + Health (4 bytes) = 33 bytes per player
  × 8 players = 264 bytes

With CBOR: ~200 bytes
With Zstd: ~80-120 bytes (depending on movement patterns)

20 Hz × 120 bytes = 2.4 KB/s per client
```

### Input Compression

```
InputState:
  Movement (8 bytes: 2 floats) + Flags (1 byte) = 9 bytes

60 Hz × 9 bytes = 540 bytes/s per client
```

**Total bandwidth per client**: ~3 KB/s (24 Kbps)

### Bandwidth Scaling

```
Players  | Down/Up per client | Total server bandwidth
---------|--------------------|-----------------------
2        | 2.4 / 0.5 KB/s    | 5.8 KB/s
4        | 2.4 / 0.5 KB/s    | 11.6 KB/s
8        | 2.4 / 0.5 KB/s    | 23.2 KB/s (186 Kbps)
```

Scales linearly with player count. Easily handles 100+ players with modern servers.

## Handling Network Issues

### High Latency (200ms+)

**Client-side prediction compensates**:
- Local player still feels responsive
- Server reconciliation may cause more noticeable corrections
- Increase correction smoothing factor

### Packet Loss

**With WebTransport**:
- Uses QUIC protocol (built-in retransmission)
- Lost snapshots are automatically retransmitted
- Stream-based: one lost packet doesn't block others

**Fallback behavior**:
- Client continues predicting during loss
- When snapshot arrives, reconcile as normal
- Longer loss = larger corrections (may snap to server)

### Jitter

**Snapshot buffering helps**:
- 150ms buffer smooths out network jitter
- Even if packets arrive irregularly, interpolation is smooth
- Adaptive buffer size could be added

## Implementation Checklist

### Server Side (Rust + C++)

- [x] C++ game loop with fixed timestep
- [x] Character movement and physics
- [x] Collision detection
- [x] State snapshot generation
- [ ] FFI bindings for Rust integration
- [ ] StreamManager integration
- [ ] CBOR serialization of snapshots
- [ ] Input deserialization

### Client Side (Babylon.js)

- [x] Babylon.js scene setup
- [x] Havok physics integration
- [x] Client-side prediction logic
- [x] Server reconciliation
- [x] Remote player interpolation
- [ ] WebTransport/WebSocket client
- [ ] CBOR deserialization
- [ ] Animation system
- [ ] Visual effects (particles, trails)
- [ ] UI (health bars, minimap)

### Network Layer

- [ ] WebTransport endpoints in Rust
- [ ] Snapshot broadcast (20 Hz)
- [ ] Input handling (60 Hz)
- [ ] Player join/leave handling
- [ ] Reconnection logic
- [ ] Anti-cheat (server-side validation)

## Testing Tips

### Test Client Prediction

1. **Add artificial lag**:
   ```typescript
   // Delay server snapshots by 200ms
   setTimeout(() => handleSnapshot(snapshot), 200);
   ```

2. **Test reconciliation**:
   ```typescript
   // Occasionally teleport player on server
   // Client should smoothly correct
   ```

3. **Visualize prediction error**:
   ```typescript
   // Draw debug sphere at server position
   // Draw debug sphere at client predicted position
   // See the difference
   ```

### Test Interpolation

1. **Reduce buffer size**:
   ```typescript
   BUFFER_SIZE = 1; // Will cause stuttering if jitter
   ```

2. **Simulate packet loss**:
   ```typescript
   // Randomly drop 10% of snapshots
   if (Math.random() < 0.1) return;
   ```

## Performance Targets

### Server
- Physics simulation: 60 FPS stable
- Per-frame budget: ~16ms
- 8 players: <2ms per frame
- 32 players: <8ms per frame

### Client
- Rendering: 60 FPS minimum
- Physics prediction: <1ms per frame
- Total frame budget: ~16ms
- Target: 60+ FPS on mid-range hardware

## Future Enhancements

1. **Lag compensation for projectiles**
   - Rewind server state when processing hits
   - "Shoot where they were" server-side

2. **Adaptive interpolation delay**
   - Measure network jitter
   - Adjust buffer size dynamically

3. **Delta compression**
   - Only send changed values
   - Further reduce bandwidth

4. **Interest management**
   - Only send snapshots for nearby players
   - Scales to hundreds of players

5. **Spectator mode**
   - Higher latency OK for spectators
   - Can watch from server's POV without prediction

## References

- [Valve's Source Engine Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
- [Overwatch Gameplay Architecture](https://www.youtube.com/watch?v=W3aieHjyNvw)
- [Gabriel Gambetta - Fast-Paced Multiplayer](https://www.gabrielgambetta.com/client-server-game-architecture.html)
- [Babylon.js Physics Documentation](https://doc.babylonjs.com/features/featuresDeepDive/physics)
