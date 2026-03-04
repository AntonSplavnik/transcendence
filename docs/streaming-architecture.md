# Streaming Architecture

Real-time communication layer built on WebTransport (HTTP/3 + QUIC). The server
has sole authority over opening streams — the client connects, authenticates,
and then accepts whatever streams the server decides to open.

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Connection Lifecycle](#connection-lifecycle)
- [Auth Handshake Deep-Dive](#auth-handshake-deep-dive)
- [Stream Multiplexing Model](#stream-multiplexing-model)
- [Notification Stream (Worked Example)](#notification-stream-worked-example)
- [Reconnection & Session Lifecycle](#reconnection--session-lifecycle)
- [Codec Layer](#codec-layer)
- [React Integration](#react-integration)
- [Security Considerations](#security-considerations)
- [Glossary](#glossary)

---

## High-Level Overview

The system uses **WebTransport** over QUIC/HTTP3 as the transport for all
real-time communication between backend and frontend. WebTransport was chosen
over WebSockets because it provides:

- **Multiplexed streams** — many independent ordered byte-streams over a single
  QUIC connection, without head-of-line blocking between them.
- **Unidirectional and bidirectional streams** — server-to-client push
  (notifications) and full-duplex communication (chat, game) on the same
  connection.
- **Low latency** — QUIC's 0-RTT and 1-RTT handshakes, plus no TCP
  head-of-line blocking.

The architecture is split into layers:

```
┌─────────────────────────────────────────────────────────┐
│                    React UI Layer                        │
│   NotificationContext · useNotifications · Toast         │
├─────────────────────────────────────────────────────────┤
│                 React Bridge Layer                       │
│   StreamContext · StreamProvider · useStream             │
├─────────────────────────────────────────────────────────┤
│              Connection Manager (pure TS)                │
│   Lifecycle · Auth handshake · Handler registry          │
│   Stream acceptance · Reconnection state machine         │
├─────────────────────────────────────────────────────────┤
│                 Codec Interface                          │
│   Codec<T> · CborZstdCodec (default impl)               │
├─────────────────────────────────────────────────────────┤
│              WebTransport API (browser)                  │
└──────────────────────┬──────────────────────────────────┘
                       │  QUIC / HTTP3
┌──────────────────────┴──────────────────────────────────┐
│           Salvo WebTransport endpoint                    │
│   connect_stream · bind_pending_stream                   │
├─────────────────────────────────────────────────────────┤
│                  StreamManager                           │
│   Connection registry · Stream requests · Framing        │
├─────────────────────────────────────────────────────────┤
│                Domain Managers                           │
│   NotificationManager · (future: ChatManager, Game…)     │
├─────────────────────────────────────────────────────────┤
│                CompressedCborCodec                       │
│   CBOR + optional Zstd · length-delimited framing        │
└─────────────────────────────────────────────────────────┘
```

**Key invariant:** The client never opens streams itself. The server opens every
stream and sends a `StreamType` header as the first frame. The client reads this
header and dispatches to the matching handler.

---

## Connection Lifecycle

The full lifecycle from page load to active streaming:

```
 Client (Browser)                              Server (Salvo)
 ════════════════                              ════════════════

 1. User logs in via REST
    ◄── session cookie ──────────────────────────────────────

 2. StreamProvider detects user ≠ null
    initZstd()  (one-time WASM init)
    │
    ▼
 3. new WebTransport(url)
    ══════ QUIC handshake ═══════════════► connect_stream()
    ◄═════ session ready ════════════════  register_pending()

 4.                                        open_uni() → Ctrl stream
    ◄── StreamType::Ctrl(PendingKey) ─────  frame_uni_stream(Ctrl)

 5. Parse PendingConnectionKey from
    Ctrl stream header
    │
    ▼
 6. POST /api/stream/bind  { key }  ─────► bind_pending_stream()
    (cookies attached = authenticated)      resolve pending → Session
    ◄── 200 OK ──────────────────────────

 7.                                        register(session, cmd_tx)
                                           on_connect(user_id):
                                             open notification stream
                                             send ServerHello

 8. Accept loop: incomingUniStreams
    ◄── StreamType::Notifications ────────
    ◄── WireNotification(ServerHello) ────
    │
    ▼
 9. Handler dispatches to
    NotificationContext → Toast appears

10. Connection stays open.
    Server opens more streams as needed.
    Client accepts and dispatches each one.
```

**Steps 3–6** are the two-step authentication handshake (detailed below).
**Steps 7–9** show the first real stream being established.

---

## Auth Handshake Deep-Dive

### The Problem

WebTransport's `CONNECT` request does not carry cookies in the browser's
WebTransport API. The server cannot authenticate who is connecting from the
CONNECT request alone. We need a mechanism to bind an anonymous QUIC session to
an authenticated user.

### The Solution: Two-Step Bind

```
Step 1: Anonymous CONNECT
─────────────────────────
Client opens WebTransport(url).
Server creates a PendingConnectionKey:
  {
    connection_id: u64,       // monotonic counter
    challenge:     [u8; 32]   // random nonce (FixedBlob<32>)
  }
Server opens the first uni stream (the "Ctrl stream") and sends
StreamType::Ctrl(PendingConnectionKey) as the header frame.
Subsequent frames on this stream carry CtrlMessage values (e.g. Displaced).
Server then waits on a oneshot channel for up to 30 seconds.

Step 2: Authenticated REST Bind
───────────────────────────────
Client reads the PendingConnectionKey from the Ctrl stream.
Client sends POST /api/stream/bind with the key as JSON body.
This endpoint is behind requires_user_login() — cookies are
sent automatically by the browser for same-origin REST calls.
Server looks up the PendingConnectionKey in its pending registry,
sends the authenticated Session through the oneshot channel.
connect_stream receives the Session and registers the connection.
```

### Why This Is Secure

- The `challenge` is 32 bytes of cryptographic randomness — it cannot be guessed.
- The bind endpoint requires a valid session cookie — an attacker cannot bind
  someone else's WebTransport session.
- The pending entry has a 30-second timeout — abandoned connections are cleaned up.
- The pending entry is removed immediately on bind or timeout (guarded by
  `PendingConnectionGuard`'s `Drop` impl).

### What Happens After Bind

Once bound, `connect_stream` calls `on_connect()` which triggers domain-specific
setup (opening notification streams, etc. — see
[Notification System](notification-system.md)) and then enters a command loop:

```rust
loop {
    tokio::select! {
        cmd = cmd_rx.recv() => {
            match cmd {
                OpenBidiStream { response }  => open_bi() → respond
                OpenUniStream  { response }  => open_uni() → respond
                Displace                     => send CtrlMessage::Displaced on Ctrl stream → break
                None                         => break  // replaced or disconnected
            }
        }
        // accept_bi() drives the h3 connection to detect QUIC closure
    }
}
```

Other server components (`NotificationManager`, future `ChatManager`, etc.)
communicate with this loop via the `StreamManager` API to open new streams on
the user's connection.

---

## Stream Multiplexing Model

### Server-Only Stream Opening

The server is the sole entity that opens streams. The pattern is always:

1. A server-side component calls `StreamManager::request_stream()` (bidi) or
   `StreamManager::request_uni_stream()` (uni) with a `user_id` and `StreamType`.
2. `StreamManager` sends a `ConnectionCommand` to the user's handler loop.
3. The handler opens the raw QUIC stream via `wt_session.open_bi()` or
   `open_uni()`.
4. The framing function sends the `StreamType` header as the first CBOR frame.
5. The typed `Sender`/`Receiver` is returned to the calling component.

### StreamType Header

Every stream's first frame is a CBOR-encoded `StreamType` value:

```rust
// Backend (Rust — serde externally-tagged)
enum StreamType {
    Ctrl(PendingConnectionKey),   // → { "Ctrl": { connection_id, challenge } }
    Notifications,                // → "Notifications"
    // future:
    // ChatRoom(i32),             // → { "ChatRoom": 42 }
    // GameSession { id: Ulid },  // → { "GameSession": { "id": "..." } }
}
```

On the frontend, `parseStreamType()` handles serde's externally-tagged format:

| Rust variant            | Wire (CBOR)                                 | Parsed                                   |
|-------------------------|---------------------------------------------|------------------------------------------|
| `Notifications`         | `"Notifications"`                           | `{ key: "Notifications", data: undefined }` |
| `Ctrl(key)`             | `{ "Ctrl": { connection_id, challenge } }`  | `{ key: "Ctrl", data: { … } }`          |
| `ChatRoom(42)`          | `{ "ChatRoom": 42 }`                        | `{ key: "ChatRoom", data: 42 }`         |

### Handler Registry

The frontend `ConnectionManager` maintains two registries:

- **`uniHandlers: Map<string, (data: unknown) => UniStreamHandler>`** — factories for server → client streams
- **`bidiHandlers: Map<string, (data: unknown, send: (msg) => void) => BidiStreamHandler>`** — factories for full-duplex streams

Handler **factories** are registered before connecting and remain active across
reconnections. Each incoming stream invokes the factory, producing a **distinct
handler instance** per stream — so multiple streams of the same `StreamType`
(e.g., several `ChatRoom` streams for different rooms) each get their own state:

```typescript
connectionManager.registerUniHandler('Notifications', (data) => ({
    // `data` is the variant payload (undefined for unit variants)
    onOpen()           { /* stream opened */ },
    onMessage(msg)     { /* subsequent frames */ },
    onClose()          { /* stream ended gracefully */ },
    onError(err)       { /* stream error */ },
}));

connectionManager.registerBidiHandler('ChatRoom', (data, send) => ({
    // `data` = room_id, `send()` writes frames back to server
    onOpen()           { /* stream opened */ },
    onMessage(msg)     { /* incoming frames from server */ },
    onClose()          { /* stream ended */ },
    onError(err)       { /* stream error */ },
}));
```

### Stream Acceptance Loops

When connected, the `ConnectionManager` runs two concurrent async loops:

1. **Uni loop** — reads from `session.incomingUnidirectionalStreams`
2. **Bidi loop** — reads from `session.incomingBidirectionalStreams`

Each loop accepts a stream, reads chunks until the first decoded message (the
`StreamType` header), looks up the registered factory, calls it with the variant
payload (and `send` for bidi streams) to create a new handler instance, calls
`onOpen()`, then continues reading and calling `onMessage()` for subsequent
frames. Stream close calls `onClose()`, errors call `onError()`.

Streams are handled concurrently — a slow handler on one stream does not block
acceptance or processing of other streams.

---

## Notification Stream (Worked Example)

Notifications demonstrate the full end-to-end flow for a unidirectional stream
type with offline persistence.

### Backend: Send-or-Store Pattern

```
NotificationManager.send(db, user_id, payload)
    │
    ├─ User has open stream? ──► Send directly via SharedSender
    │                                │
    │                                ├─ Success → return Ok
    │                                └─ Channel closed → cleanup, fall through ▼
    │
    └─ No stream (or send failed) ──► Store to DB (notifications table)
                                      CborBlob<NotificationPayload>
```

### Backend: Stream Lifecycle

On user connect, `on_connect()` triggers:

```
NotificationManager.open_stream(db, streams, user_id)
    │
    ├─ 1. StreamManager.request_uni_stream(user_id, StreamType::Notifications)
    │     → server opens uni stream, sends "Notifications" header
    │     → returns Sender<WireNotification>
    │
    ├─ 2. Wrap Sender in SharedSender (cloneable, spawns forwarding task)
    │
    ├─ 3. Register in streams map (replaces any previous sender)
    │
    └─ 4. Drain DB backlog (oldest → newest)
          SELECT + DELETE in single transaction
          Send each stored notification over the new stream
          If send fails mid-drain: re-store unsent notifications to DB
```

### Frontend: Handler → React State → Toast

```
Incoming uni stream
    │
    ├─ Decode StreamType header → "Notifications"
    │  Look up factory via uniHandlers.get("Notifications")
    │  Call factory(data) → handler instance
    │
    ├─ handler.onOpen() → log "stream opened"
    │
    ├─ handler.onMessage(wireNotification)
    │     │
    │     ├─ setNotifications(prev => [notification, ...prev])
    │     └─ setLatestToast(notification)
    │           │
    │           └─ NotificationToast renders:
    │              "Connected to server"  (for ServerHello)
    │              Auto-dismiss after 5 seconds
    │
    └─ handler.onClose() → log "stream closed"
```

### Wire Payload

```typescript
// WireNotification (mirrors Rust struct)
{
    payload: "ServerHello",        // NotificationPayload enum variant
    created_at: "2026-02-17T…"     // ISO-8601 timestamp
}
```

### Delivery Guarantees

- **Online:** Payload goes directly to the wire — zero DB round-trip.
- **Offline:** Payload is persisted to the `notifications` table.
- **Reconnect:** All stored notifications are drained (oldest first) and sent
  over the new stream before any new notifications.
- **Partial failure:** If the stream breaks mid-drain, unsent notifications
  are re-stored to the DB.
- **Ordering:** Every notification carries a `created_at` timestamp. Because
  the registration-before-drain pattern may deliver new notifications before
  the backlog, the client can sort by timestamp if strict ordering is needed.

---

## Reconnection & Session Lifecycle

### Automatic Reconnection

The `ConnectionManager` implements a state machine:

```
 disconnected ──connect()──► connecting ──► authenticating ──► connected
       ▲                         │               │                │
       │                         │               │                │
       │      ┌──────────────────┘               │                │
       │      │  connect failed                  │                │
       │      ▼                                  │                │
       │  reconnecting ◄────────────────────────-┘────────────────┘
       │      │                                session closed /
       │      │  delay (exp backoff)           transport error
       │      ▼
       │  connecting (retry)
       │
       ├──── disconnect() called (intentional)
       │     or maxRetries exceeded
       │     or destroy() called
       │
       │                                         CtrlMessage::Displaced
       │                                         received on Ctrl stream
       │                                                │
       │                                                ▼
       └─────────────────────────────────────────── displaced
                                              (no reconnection)
```

**Backoff formula:** `delay = min(1000 × 2^attempt, 40000) + random(0, 500)` ms

| Attempt | Delay range       |
|---------|-------------------|
| 0       | 1.0 – 1.5 s      |
| 1       | 2.0 – 2.5 s      |
| 2       | 4.0 – 4.5 s      |
| 3       | 8.0 – 8.5 s      |
| 4       | 16.0 – 16.5 s    |
| 5       | 32.0 – 32.5 s    |
| 6+      | 40.0 – 40.5 s    |

The attempt counter resets to 0 on a successful connection.

### State Observation

Connection state is observable via a subscribe/listener pattern:

```typescript
const unsubscribe = manager.subscribe((state: ConnectionState) => {
    // state.status: 'disconnected' | 'connecting' | 'authenticating'
    //             | 'connected' | 'reconnecting' | 'displaced'
    // if reconnecting: state.attempt, state.nextRetryMs
});
```

The `StreamProvider` wraps this in React state, so any component can read
`connectionState` via `useStream()`.

### Session Expiry & JWT Refresh

On the backend, each registered connection spawns an auto-disconnect task
scheduled at `session.access_expiry()`:

```
Connection registered
    │
    ├─ Spawn task: sleep until access_expiry, then unregister
    │
    ├─ JWT refreshed (via REST /auth/session-management/refresh-jwt)?
    │     StreamManager.refresh_auth(session)
    │     → abort old task, spawn new one with extended expiry
    │
    └─ Access expired without refresh?
          → unregister → handler loop exits → client sees session close
          → ConnectionManager transitions to reconnecting
```

The frontend's `useJwtRefresh` hook schedules JWT refresh 1 minute before
expiry. A successful refresh calls `refresh_auth` on the `StreamManager`,
which extends the connection's lifetime. This means a user who stays on the
page will maintain their streaming connection indefinitely.

### Single Connection Policy & Session Displacement

Each user can have exactly **one** active WebTransport connection. If the
same user connects from a second tab:

1. `StreamManager::register()` detects the existing `ConnectionEntry`.
2. A `ConnectionCommand::Displace` is sent to the old handler via `try_send`.
3. The old handler sends `CtrlMessage::Displaced` on the Ctrl uni stream,
   waits 50 ms for the message to be delivered, then exits the loop.
4. The old tab's `ConnectionManager` receives `Displaced` via
   `listenCtrlStream()` → `handleCtrlMessage()`, sets state to `displaced`,
   and sets `intentionalDisconnect = true` to suppress reconnection.
5. UI components react to the `displaced` state:
   - `DisplacedModal` ([`frontend/src/components/modals/DisplacedModal.tsx`](../frontend/src/components/modals/DisplacedModal.tsx))
     shows a dismissible modal explaining the displacement. A "Reconnect
     here" button triggers a full page reload.
   - `ConnectionStatusBanner` ([`frontend/src/components/ui/ConnectionStatusBanner.tsx`](../frontend/src/components/ui/ConnectionStatusBanner.tsx))
     shows a sticky top bar: "Connected from another location — realtime
     features unavailable".

This is a "last writer wins" policy. The displaced tab can still browse
(REST calls work) but real-time features (notifications, live updates) are
unavailable until the user clicks "Reconnect here".

---

## Codec Layer

### Wire Format

Each frame on the wire:

```
┌─────────────┬───────────┬────────────────────┐
│ total_len   │  flags    │       payload      │
│   (4 bytes) │  (1 byte) │  (variable length) │
│   BE u32    │           │                    │
└─────────────┴───────────┴────────────────────┘
```

- **`total_len`**: Length of `flags + payload` (not including the 4-byte prefix
  itself).
- **`flags`**:
  - `0x00` — payload is raw CBOR
  - `0x01` — payload is Zstd-compressed CBOR
- **`payload`**: CBOR bytes (raw or compressed)

### Compression Thresholds

| Side    | Threshold | Rationale                                    |
|---------|-----------|----------------------------------------------|
| Server  | 1024 B    | Conserve server CPU; most messages are small  |
| Client  | 512 B     | Upload bandwidth is more constrained          |

Zstd compression level: **3** (both sides).

### Frame Size Limits

| Limit              | Size    | Purpose                             |
|--------------------|---------|-------------------------------------|
| Max encode (client)| 8 MiB   | Fail fast on oversized outgoing     |
| Max decode (server)| 8 MiB   | Prevent memory exhaustion           |
| Max decode (client)| 64 MiB  | Generous limit for server responses |

### Swappable Codec Interface

The frontend codec is abstracted behind an interface:

```typescript
interface Codec {
    encode(value: unknown): Uint8Array;
    createDecoder<T>(): StreamDecoder<T>;
}

interface StreamDecoder<T> {
    push(chunk: Uint8Array | ArrayBuffer): T[];
    reset(): void;
}
```

The default implementation (`CborZstdCodec`) wraps `CompressedCborEncoder` and
`CompressedCborDecoder`. To swap codecs, provide a different `Codec`
implementation to the `ConnectionManager` constructor:

```typescript
new ConnectionManager({
    codec: new MyCustomCodec(),  // implements Codec
});
```

### Zstd Initialization

The Zstd WASM module must be initialized exactly once before any
encode/decode:

```typescript
await initZstd();  // called by StreamProvider on mount
```

---

## React Integration

### Provider Nesting

```tsx
<HashRouter>
  <AuthProvider>           // user state, login/logout
    <StreamProvider>       // owns ConnectionManager, connects on auth
      <NotificationProvider>  // registers notification handler
        <AppRoutes />
        <NotificationToast />  // renders latest toast
      </NotificationProvider>
    </StreamProvider>
  </AuthProvider>
</HashRouter>
```

The nesting order matters:
- `StreamProvider` depends on `AuthProvider` (reads `user` to know when to
  connect/disconnect).
- `NotificationProvider` depends on `StreamProvider` (registers handlers on
  `ConnectionManager`).

### Available Hooks

| Hook                 | Returns                                          | Use case                          |
|----------------------|--------------------------------------------------|-----------------------------------|
| `useStream()`        | `{ connectionManager, connectionState }`         | Register handlers, check status   |
| `useNotifications()` | `{ notifications, activeToasts, dismissToast }`  | Read notifications, manage toasts |

### Connecting a New Feature to Streams

To add a new stream-powered feature (e.g., chat):

```tsx
function ChatProvider({ children }) {
    const { connectionManager } = useStream();

    useEffect(() => {
        connectionManager.registerBidiHandler('ChatRoom', (data, send) => {
            const roomId = data as number;
            // Each ChatRoom stream gets its own handler instance,
            // so multiple rooms can be open simultaneously.
            return {
                onOpen() {
                    // store send function, set up room state for roomId
                },
                onMessage(msg) {
                    // append to chat messages for this room
                },
                onClose() {
                    // mark room as disconnected
                },
            };
        });
        return () => connectionManager.unregisterHandler('ChatRoom');
    }, [connectionManager]);

    return <ChatContext.Provider value={…}>{children}</ChatContext.Provider>;
}
```

### ConnectionManager is Framework-Agnostic

The `ConnectionManager` class has zero React imports. It uses a
subscribe/listener pattern, making it usable in:

- React (via `StreamContext`)
- A Web Worker (for game logic off the main thread)
- Tests (no DOM needed)
- Any other framework

---

## Security Considerations

### Authentication

- WebTransport CONNECT cannot carry cookies → two-step auth handshake with
  cryptographic challenge (32-byte random nonce).
- The bind endpoint requires a valid session cookie — no unauthenticated user
  can bind a connection.
- Pending connections timeout after 30 seconds.
- The `PendingConnectionGuard` ensures cleanup on all code paths (including
  panics) via `Drop`.

### Rate Limiting

| Endpoint                         | Limit           |
|----------------------------------|-----------------|
| `POST /api/stream/bind`          | 10 / minute     |
| `CONNECT /api/stream/connect`    | 30 / 5 minutes  |

### Frame Size Protection

Both encoder and decoder enforce maximum frame sizes to prevent:
- **Client → server:** 8 MiB max encode, preventing the client from sending
  frames the server would reject.
- **Server → client:** 64 MiB max decode, preventing a corrupted length prefix
  from causing unbounded memory allocation.
- **Server-side decoder:** 8 MiB max, preventing a malicious client from
  exhausting server memory.

### Single Connection Per User

Only one WebTransport session per user is allowed. A new connection replaces
the old one, preventing:
- Resource exhaustion from abandoned connections.
- Inconsistent state across multiple tabs.
- Amplification attacks.

### Stream Authority

The client cannot open streams — only accept them. This prevents:
- Clients from requesting arbitrary resources.
- Protocol confusion attacks.
- Resource exhaustion on the server from client-initiated streams.

The server validates every stream it opens against the authenticated user's
permissions before sending the `StreamType` header.

---

## Glossary

| Term                     | Definition                                                                                        |
|--------------------------|---------------------------------------------------------------------------------------------------|
| **WebTransport**         | Browser API for multiplexed, bidirectional communication over QUIC/HTTP3.                         |
| **QUIC**                 | Transport protocol providing multiplexed streams, TLS 1.3, and low-latency connection setup.      |
| **StreamType**           | Enum sent as the first frame of every stream. Identifies the stream's purpose and handler.         |
| **Ctrl stream**          | The initial uni stream (server → client) carrying `StreamType::Ctrl(PendingConnectionKey)`. Subsequent frames carry `CtrlMessage` values. |
| **PendingConnectionKey** | `{ connection_id, challenge }` — binds an anonymous QUIC session to an authenticated user.        |
| **Bind (auth handshake)**| POST to `/api/stream/bind` that resolves a pending connection with the caller's session cookies.   |
| **StreamManager**        | Backend singleton managing the connection registry and stream open commands. Injected via Depot.   |
| **ConnectionManager**    | Frontend class managing WebTransport lifecycle, auth handshake, reconnection, and handler dispatch.|
| **SharedSender**         | Cloneable, comparable wrapper around `mpsc::Sender` that spawns a forwarding task to the stream.  |
| **ConnectionEntry**      | Backend struct holding the command channel and auto-disconnect task for one user's connection.     |
| **UniStreamHandler**     | Frontend callback interface for server → client streams: `onOpen`, `onMessage`, `onClose`, `onError`. Created per-stream by a handler factory. |
| **BidiStreamHandler**    | Frontend callback interface for bidirectional streams. Same as uni but factory receives `send`. Created per-stream by a handler factory. |
| **Codec**                | Interface for encoding/decoding wire frames. Default: CBOR + Zstd (`CborZstdCodec`).             |
| **CompressedCborCodec**  | Length-delimited CBOR codec with optional Zstd compression. Shared wire format across both sides. |
| **WireNotification**     | `{ payload: NotificationPayload, created_at }` — the notification struct as it appears on the wire.|
| **Send-or-store**        | Notification delivery pattern: send directly if stream is open, otherwise persist to DB.          |
| **Displaced**            | Connection state entered when the server sends `CtrlMessage::Displaced`. Reconnection is suppressed. UI shows `DisplacedModal` + `ConnectionStatusBanner`. |
| **on_connect**           | Server function called after auth handshake succeeds. Opens notification stream, sends ServerHello. See [Notification System](notification-system.md). |
| **StreamProvider**       | React context that owns the `ConnectionManager` and connects/disconnects based on auth state.     |
| **NotificationProvider** | React context that registers the notification stream handler and maintains notification state. See [Notification System](notification-system.md). |
