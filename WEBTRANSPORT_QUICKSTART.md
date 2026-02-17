# WebTransport Game Server - Quick Reference

## Overview

Minimal test client for the WebTransport game server backend. Enables real-time bidirectional communication for multiplayer gameplay using WebTransport over HTTP/3.

**Stack:**
- Frontend: React + WebTransport API + CBOR/Zstd compression
- Backend: Rust (Salvo) + C++ game engine (EnTT ECS)
- Protocol: WebTransport (HTTP/3 over QUIC)

---

## Running the Game

### Start Servers

```bash
# Install frontend dependencies (first time only)
cd frontend && npm install && cd ..

# Start both servers
make dev
```

This starts:
- Backend: `https://127.0.0.1:8443`
- Frontend: `http://localhost:5173`

### Open in Browser (Chrome Only)

**Important:** Regular Chrome won't work. You must use Chrome with specific flags:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --origin-to-force-quic-on=127.0.0.1:8443 \
  --ignore-certificate-errors-spki-list=placeholder \
  http://localhost:5173/game
```

**Why these flags are required:**
- `--origin-to-force-quic-on`: Enables HTTP/3 (QUIC) for WebTransport
- `--ignore-certificate-errors-spki-list`: Allows self-signed certificates for QUIC

### Testing

1. Navigate to `/game`
2. Click "Connect"
3. Enter player name
4. Click "Join Game"
5. Use arrow keys to move (↑↓←→)
6. Position updates in real-time

---

## SSL/TLS Certificates

### Why Certificates Are Required

WebTransport requires HTTPS by specification. Plain HTTP is not supported.

### Development Setup (Current)

We use **mkcert** to generate locally-trusted certificates:

```bash
# Install mkcert (one-time setup)
brew install mkcert
mkcert -install

# Generate certificates
cd backend/certs
mkcert -key-file key.pem -cert-file cert.pem 127.0.0.1 localhost
```

This creates:
- `backend/certs/cert.pem` - SSL certificate
- `backend/certs/key.pem` - Private key

### 'Why Chrome Flags Are Still Needed

Even with mkcert certificates, WebTransport/QUIC doesn't fully trust locally-issued Certificate Authorities. Chrome requires explicit flags to bypass this restriction during development.

### Production Setup

In production, use certificates from a trusted Certificate Authority. **Chrome flags will not be needed.**

#### Option 1: Let's Encrypt (Recommended)

```bash
sudo certbot certonly --standalone -d yourdomain.com
```

- Free, automatically trusted by all browsers
- Auto-renewal supported
- Requires public domain name

The backend already supports ACME (Let's Encrypt) - see `backend/src/main.rs`.

#### Option 2: Commercial CA

Purchase SSL certificate from DigiCert, GlobalSign, or similar providers.

#### Option 3: CloudFlare

Use CloudFlare as a proxy with their free SSL certificates. Note: Verify WebTransport compatibility.

---

## Architecture

### Connection Flow

```
1. Browser → WebTransport CONNECT https://127.0.0.1:8443/api/stream/connect
2. Server → Opens control stream, sends pending authentication key
3. Browser → POST /api/stream/bind (pending key + session cookies)
4. Server → Authenticates and registers connection
5. Browser → POST /api/game/join_stream (player name)
6. Server → Opens bidirectional game stream
7. Bidirectional communication begins:
   - Client: Input messages (movement, actions)
   - Server: Snapshots (game state at 20Hz)
```

### Message Format

**Client to Server (Input):**
```json
{
  "type": "Input",
  "movement": { "x": -1, "y": 0, "z": 0 },
  "look_direction": { "x": 0, "y": 1, "z": 0 },
  "attacking": false,
  "jumping": false
}
```

**Server to Client (Snapshot):**
```json
{
  "type": "Snapshot",
  "frame_number": 1234,
  "timestamp": 61.7,
  "characters": [{
    "player_id": 1,
    "position": { "x": 78.5, "y": 0.0, "z": 50.0 },
    "velocity": { "x": -8.0, "y": 0.0, "z": 0.0 },
    "health": 100,
    "max_health": 100
  }]
}
```

### Input Design: State-Based vs Event-Based

**Current Implementation (State-Based):**
- Client continuously sends current input state
- Key press: send `movement: {x: 1, z: 0}`
- Key release: send `movement: {x: 0, z: 0}`
- Server applies latest received state

**Why not event-based:**
- Server cannot distinguish between "player released key" and "network delay"
- Requires timeout logic and state tracking
- Less reliable, harder to debug
- State-based is industry standard (Unity, Unreal, Source Engine)

---

## Performance Metrics

**Expected values:**
- Snapshot rate: 20 FPS (50ms intervals)
- Input latency: <50ms (local network)
- Message size: 200-500 bytes (Zstd compressed)

---

## Current Limitations

This is a proof-of-concept test client:

- No client-side prediction
- No entity interpolation/extrapolation
- Table-based display (no 3D graphics)
- Requires Chrome with flags (development certificates)
- Basic input handling (arrow keys only)

**Production requirements:**
- Client-side prediction for responsive movement
- Entity interpolation for smooth rendering
- 3D graphics engine (Three.js, Babylon.js)
- Real SSL certificates (removes Chrome flags requirement)
- Full input system (WASD, mouse, abilities)
- Reconnection and error recovery logic

---

## Verification

This implementation validates:
- WebTransport bidirectional communication
- CBOR encoding with Zstd compression
- C++ game engine (ECS architecture)
- Server-initiated stream pattern
- Physics simulation and input processing

---

## Quick Start Summary

**To run:**
```bash
make dev
```

**To test:**
```bash
# Open Chrome with flags
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --origin-to-force-quic-on=127.0.0.1:8443 \
  --ignore-certificate-errors-spki-list=placeholder \
  http://localhost:5173/game
```

**Why Chrome flags:**
Development certificates aren't fully trusted by WebTransport. Production uses Let's Encrypt (no flags needed).

**Next steps:**
Deploy with real domain and Let's Encrypt certificate to eliminate Chrome flags requirement.
