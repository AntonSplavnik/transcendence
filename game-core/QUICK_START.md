# Quick Start Guide

Test the game engine and client **right now** without any Rust integration!

## What You'll Test

✅ C++ game physics (server-authoritative)
✅ Babylon.js client with client-side prediction
✅ Real-time multiplayer over WebSocket
✅ 3D arena combat with movement and jumping

## Option 1: Test C++ Game Engine (Console Only)

Already compiled! Just run:

```bash
cd game_engine
./game_server
```

You'll see:
- Two AI players moving in opposite directions
- Physics running at 60 FPS
- Game state snapshots at 20 Hz
- Players hitting arena boundaries

**Output:**
```
=== Frame 3 at 0.05s ===
Player 1 at (80, 0, 60) HP: 100/100
Player 2 at (80, 0, 40) HP: 100/100
...
```

## Option 2: Test Babylon.js Client (Full 3D)

### Step 1: Install Dependencies

```bash
cd game_engine/client_example
npm install
```

### Step 2: Start Mock Server

In **terminal 1**:
```bash
npm run server
```

You'll see:
```
Mock game server running on ws://localhost:8080
Connect your Babylon.js client to test!
```

### Step 3: Start Client

In **terminal 2**:
```bash
npm run dev
```

You'll see:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  press h + enter to show help
```

### Step 4: Play!

1. Open http://localhost:5173/ in your browser
2. You'll see a 3D arena with your character
3. **Controls:**
   - **WASD** - Move around
   - **Space** - Jump
   - **Mouse** - Look around
   - **Left Click** - Attack

4. Open multiple browser tabs to test multiplayer! Each tab is a new player.

## What You Should See

### In Browser:
- **3D character** (capsule shape) that you control
- **Other players** moving around (open multiple tabs)
- **Smooth movement** even though server only sends 20 updates/sec
- **Instant response** to your input (client-side prediction)
- **UI overlay** showing:
  - Connection status
  - Player ID
  - Frame number
  - Ping
  - Health bar

### In Server Terminal:
```
Player 1234 connected
Player 5678 connected
...
```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080

# Kill it
kill -9 <PID>
```

### Client Can't Connect

Check that:
1. Mock server is running on port 8080
2. Browser console shows WebSocket connection
3. No firewall blocking localhost:8080

### Babylon.js Errors

Make sure you installed dependencies:
```bash
cd game_engine/client_example
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

Once you see multiplayer working:

1. **Integrate with Rust** - Follow `INTEGRATION_GUIDE.md`
2. **Add Combat** - Implement projectiles and damage
3. **Add Visuals** - Replace capsules with 3D character models
4. **Add Effects** - Particles, trails, explosions
5. **Add Items** - Loot drops, equipment, inventory

## Architecture

```
Browser Tab 1 ─┐
Browser Tab 2 ─┼─ WebSocket ─→ Mock Server (Node.js)
Browser Tab 3 ─┘                     ↓
                              Physics at 60 FPS
                                     ↓
                           Broadcast snapshots at 20 Hz
```

## Performance Notes

With the mock server you should see:
- **60 FPS** rendering in browser
- **~20ms ping** (localhost)
- **Smooth interpolation** of remote players
- **Instant response** for local player

## Current Limitations (Mock Server)

The Node.js mock server is simplified:
- ❌ No collision between players
- ❌ No combat damage
- ❌ No server validation (can be cheated)

The C++ engine has all of this! Follow INTEGRATION_GUIDE.md to use it.

## Quick Test Scenarios

### Test Client Prediction

1. Open DevTools → Network → Throttling
2. Set to "Slow 3G"
3. Move your character
4. Notice: **Still feels responsive!** (prediction working)

### Test Interpolation

1. Open 2 browser tabs
2. Move in tab 1
3. Watch tab 2: **Smooth movement** even with 20Hz updates

### Test Reconciliation

1. Open DevTools Console
2. Type: `window.artificialLag = 200` (adds 200ms lag)
3. Move your character
4. Small corrections visible but movement still smooth

## Files Overview

```
game_engine/
├── game_server              ← Compiled C++ binary (run this!)
├── client_example/
│   ├── mock_server.js       ← WebSocket server
│   ├── client_prediction.ts ← Babylon.js client
│   ├── index.html           ← Open in browser
│   └── package.json         ← Dependencies
└── include/
    ├── GameTypes.hpp        ← Core game types
    ├── Character.hpp        ← Character logic
    └── ArenaGame.hpp        ← Game loop
```

## Have Fun!

You're running a fully functional multiplayer 3D game engine! 🎮

Questions? Check:
- `ARCHITECTURE.md` - How it all works
- `INTEGRATION_GUIDE.md` - Connect to Rust backend
- `README.md` - General overview
