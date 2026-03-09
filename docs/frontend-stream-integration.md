# Frontend Stream Integration Guide

How the frontend streaming system works and how to connect new features to it.

## Table of Contents

- [Architecture at a Glance](#architecture-at-a-glance)
- [Module Map](#module-map)
- [Initialization Flow](#initialization-flow)
- [ConnectionManager API](#connectionmanager-api)
- [Codec Abstraction](#codec-abstraction)
- [Handler Pattern](#handler-pattern)
- [Building a Feature on Streams](#building-a-feature-on-streams)
- [Debugging Tips](#debugging-tips)

---

## Architecture at a Glance

```
┌──────────────┐    ┌──────────────┐     ┌─────────────┐
│ React Context│───▶│ Connection   │────▶│ WebTransport│──▶ Server
│ (StreamCtx)  │    │ Manager      │     │ Session     │
└──────┬───────┘    └──────┬───────┘     └─────────────┘
       │                   │
       │            ┌──────┴───────┐
       │            │ Codec        │  (CborZstdCodec)
       │            └──────────────┘
       │
┌──────┴────────────────────────────┐
│ Feature Contexts                  │
│  NotificationCtx, ChatCtx, …     │
│  (register handlers, hold state) │
└───────────────────────────────────┘
```

The layering is strict:

1. **Transport** — `WebTransport` browser API (HTTP/3 + QUIC).
2. **ConnectionManager** — pure TypeScript. Owns the session, handshake,
   reconnect logic, and stream dispatch. No React dependency.
3. **Codec** — pluggable encode/decode. Default: `CborZstdCodec`.
4. **StreamContext** — thin React bridge. Creates the manager, connects on
   auth, exposes state.
5. **Feature Contexts** — register stream handlers and manage domain state.

---

## Module Map

| Module | File | Description |
|--------|------|-------------|
| Types | `src/stream/types.ts` | `StreamType`, `ConnectionState`, handler interfaces, `parseStreamType()` |
| Codec interface | `src/stream/codec.ts` | `Codec`/`StreamDecoder` interfaces + `CborZstdCodec` |
| CompressedCborCodec | `src/stream/CompressedCborCodec.ts` | Low-level encoder/decoder (Zstd WASM + cbor-x) |
| ConnectionManager | `src/stream/ConnectionManager.ts` | Transport lifecycle, handshake, reconnect, dispatch |
| Stream REST API | `src/api/stream.ts` | `bindStream()` — authenticated REST endpoint for handshake |
| StreamContext | `src/contexts/StreamContext.tsx` | React provider/hook bridging manager to component tree |
| NotificationContext | `src/contexts/NotificationContext.tsx` | First feature built on the stream system |
| NotificationToast | `src/components/ui/NotificationToast.tsx` | UI component rendering notifications |

---

## Initialization Flow

```
App mounts
  └─ AuthProvider
       └─ StreamProvider   ← creates ConnectionManager (useRef, once)
            │
            ├─ subscribes to manager state → setConnectionState
            │
            └─ useEffect on `user`:
                 user != null → initZstd() → manager.connect()
                 user == null → manager.disconnect()
```

`initZstd()` must be called before encoding/decoding compressed frames. It
loads the Zstd WASM module. The call is idempotent — safe to call multiple
times.

### connect() internals

```
1. Create WebTransport session → "connecting"
2. Await session.ready
3. Accept first uni stream (Ctrl stream) → "authenticating"
4. Read StreamType header: { Ctrl: { connection_id, challenge } }
5. POST /api/stream/bind with the key (HTTP, uses session cookie)
6. Server validates → resolves pending connection
7. setState("connected")
8. Launch acceptUniStreams() + acceptBidiStreams() loops
```

If the connection drops unexpectedly, the manager transitions to
`"reconnecting"` and retries with exponential backoff:

```
delay = min(1000 × 2^attempt, 40000) + random(0, 500) ms
```

---

## ConnectionManager API

### Construction

```typescript
import { ConnectionManager } from '../stream/ConnectionManager';
import { CborZstdCodec } from '../stream/codec';

const manager = new ConnectionManager({
    codec: new CborZstdCodec(),
    getStreamUrl: () => 'https://localhost:8443/api/stream/connect', // optional
    maxRetries: Infinity,  // optional, default Infinity
});
```

### Lifecycle

| Method | Description |
|--------|-------------|
| `connect(): Promise<void>` | Initiate connection. Resolves when authenticated. |
| `disconnect(): void` | Graceful close. No reconnection. |
| `destroy(): void` | Permanent teardown. Must not be reused. |

### State Observation

| Method | Description |
|--------|-------------|
| `getState(): ConnectionState` | Current state snapshot. |
| `subscribe(fn): () => void` | Listen for state changes. Returns unsubscribe. |

`ConnectionState` is a discriminated union:

```typescript
type ConnectionState =
    | { status: 'disconnected' }
    | { status: 'connecting' }
    | { status: 'authenticating' }
    | { status: 'connected' }
    | { status: 'reconnecting'; attempt: number; nextRetryMs: number }
    | { status: 'displaced' };
```

The `displaced` state is entered when the server sends a `CtrlMessage::Displaced`
on the Ctrl uni stream, indicating another session for the same user has taken
over. Reconnection is suppressed in this state. See
[Displacement UI](#displacement-ui) below.

### Handler Registration

| Method | Description |
|--------|-------------|
| `registerUniHandler(type, factory)` | Register a factory for server → client streams. Called per stream. |
| `registerBidiHandler(type, factory)` | Register a factory for bidirectional streams. Called per stream. |
| `unregisterHandler(type)` | Remove factory for a stream type. |

`type` is the **variant name** string — e.g. `"Notifications"`, `"ChatRoom"`.

Registering a factory for an already-registered type logs a warning and
replaces the previous factory.

---

## Codec Abstraction

The codec is injected at construction and used for all stream encoding/decoding.

### Interface

```typescript
interface Codec {
    encode(value: unknown): Uint8Array;
    createDecoder<T = unknown>(): StreamDecoder<T>;
}

interface StreamDecoder<T = unknown> {
    push(chunk: Uint8Array | ArrayBuffer): T[];
    reset(): void;
}
```

### Swapping Codecs

To use a different wire format:

1. Implement the `Codec` interface.
2. Pass it when creating the `ConnectionManager`.

```typescript
class JsonCodec implements Codec {
    encode(value: unknown): Uint8Array {
        return new TextEncoder().encode(JSON.stringify(value));
    }
    createDecoder<T>(): StreamDecoder<T> {
        return new JsonDecoder<T>();
    }
}

const manager = new ConnectionManager({ codec: new JsonCodec() });
```

The rest of the system is unchanged — handlers, contexts, and components
don't know about the wire format.

**Note:** Both sides must use the same codec. If you swap the frontend codec,
the backend codec must be swapped to match.

---

## Handler Pattern

All incoming streams from the server are dispatched by `StreamType` variant
name to registered handler **factories**. Each incoming stream invokes the
factory, producing a distinct handler instance — so multiple streams of the
same type each get their own state.

### Uni-directional (Server → Client)

```typescript
interface UniStreamHandler<T = unknown> {
    onOpen?(): void;
    onMessage(msg: T): void;
    onClose?(): void;
    onError?(err: unknown): void;
}

// Factory signature:
type UniHandlerFactory<T = unknown> = (data: unknown) => UniStreamHandler<T>;
```

### Bidirectional

```typescript
interface BidiStreamHandler<TRecv = unknown, TSend = unknown> {
    onOpen?(): void;
    onMessage(msg: TRecv): void;
    onClose?(): void;
    onError?(err: unknown): void;
}

// Factory signature:
type BidiHandlerFactory<TRecv = unknown, TSend = unknown> =
    (data: unknown, send: (msg: TSend) => void) => BidiStreamHandler<TRecv, TSend>;
```

Key differences from uni:
- The factory receives a `send` function for writing frames back to the server.
- The `send` callback serializes via the codec and writes to the stream.

Both `data` and `send` are provided to the **factory** rather than to
`onOpen()`, so the handler instance can close over them.

### Callback Sequence

```
Stream opened by server
   ↓
Read StreamType header (first CBOR frame)
   ↓
Parse variant: { key, data } = parseStreamType(raw)
   ↓
Look up factory by key
   ↓
factory(data)              ← creates handler instance (data & send captured in closure)
   ↓
handler.onOpen()           ← once (no arguments)
   ↓
handler.onMessage(frame)   ← 0..N times
   ↓
handler.onClose()          ← when stream ends normally
   or
handler.onError(err)       ← on error
```

### data Parameter

The `data` passed to the **factory** comes from the StreamType variant:

| StreamType | `data` value |
|-----------|--------------|
| `"Notifications"` (unit variant) | `undefined` |
| `{ "ChatRoom": 42 }` (newtype variant) | `42` |
| `{ "Game": { id: "...", mode: "ranked" } }` (struct variant) | `{ id: "...", mode: "ranked" }` |

---

## Building a Feature on Streams

End-to-end pattern for adding a new streamed feature to the frontend.

### 1. Define Types

In `src/stream/types.ts`:

```typescript
// Extend the StreamType union
export type StreamType =
    | 'Notifications'
    | { Ctrl: PendingConnectionKey }
    | { YourFeature: YourHeaderData };  // ← add

// Define the wire message type
export interface YourWireMessage {
    field: string;
    value: number;
}
```

### 2. Create a Context

In `src/contexts/YourFeatureContext.tsx`:

```typescript
export function YourFeatureProvider({ children }: { children: ReactNode }) {
    const { connectionManager } = useStream();
    const [messages, setMessages] = useState<YourWireMessage[]>([]);

    useEffect(() => {
        connectionManager.registerUniHandler('YourFeature', (data) => ({
            // data = header payload (if any), captured in closure
            onOpen() {
                // stream is ready
            },
            onMessage(msg: YourWireMessage) {
                setMessages(prev => [...prev, msg]);
            },
        }));
        return () => connectionManager.unregisterHandler('YourFeature');
    }, [connectionManager]);

    return (
        <YourFeatureContext.Provider value={{ messages }}>
            {children}
        </YourFeatureContext.Provider>
    );
}
```

### 3. Nest the Provider

In `App.tsx`:

```tsx
<StreamProvider>
    <NotificationProvider>
        <YourFeatureProvider>
            <AppRoutes />
        </YourFeatureProvider>
    </NotificationProvider>
</StreamProvider>
```

### 4. Consume in Components

```tsx
function MyComponent() {
    const { messages } = useYourFeature();
    return <ul>{messages.map(m => <li key={m.value}>{m.field}</li>)}</ul>;
}
```

---

## Debugging Tips

### Console Logging

The `ConnectionManager` logs key lifecycle events to the console:

- `[ConnectionManager] connecting to <url>`
- `[ConnectionManager] authenticated`
- `[ConnectionManager] stream closed: <reason>`
- `[ConnectionManager] reconnecting (attempt N, delay Nms)`

### Connection State in React

Use the `useStream()` hook to display connection state:

```tsx
function ConnectionStatus() {
    const { connectionState } = useStream();
    return <span>{connectionState.status}</span>;
}
```

### Common Issues

| Symptom | Likely Cause |
|---------|-------------|
| "connecting" forever | WebTransport URL wrong, TLS cert not trusted, or server not running |
| "authenticating" then disconnect | Session cookie missing/expired, `/api/stream/bind` returns 401 |
| Frames not decoding | Zstd not initialized — ensure `await initZstd()` |
| Handler never called | Handler registered after connection established and stream already opened, or wrong variant name string |
| Toast not appearing | `NotificationProvider` not nested inside `StreamProvider` |

### Browser Compatibility

WebTransport requires:
- Chrome 97+ / Edge 97+
- Firefox (behind flag as of 2025)
- No Safari support yet

Check `'WebTransport' in window` before relying on streaming.

---

## CtrlMessage & Displacement

After the auth handshake, the Ctrl uni stream stays open for the lifetime of
the connection. Subsequent CBOR frames on this stream are `CtrlMessage` values.

### CtrlMessage Type

```typescript
// Mirrors backend CtrlMessage enum (serde externally-tagged)
export type CtrlMessage = 'Displaced';
```

Currently the only variant is `Displaced`, sent when the server replaces this
connection with a newer one from the same user.

### Displacement Flow

```
Server detects duplicate user connection
    │
    ├─ Sends CtrlMessage::Displaced on old connection's Ctrl uni stream
    │
    ▼
ConnectionManager.listenCtrlStream()
    │
    ├─ Decodes "Displaced" message
    │
    ├─ handleCtrlMessage("Displaced")
    │     ├─ Sets intentionalDisconnect = true  (suppresses reconnection)
    │     └─ setState({ status: 'displaced' })
    │
    ▼
UI components react:
    ├─ DisplacedModal:         Modal with "Dismiss" and "Reconnect here"
    └─ ConnectionStatusBanner: Sticky bar "Connected from another location"
```

### Displacement UI

| Component | File | Behaviour |
|-----------|------|-----------|
| `DisplacedModal` | `src/components/modals/DisplacedModal.tsx` | Dismissible modal. "Reconnect here" triggers `window.location.reload()`. |
| `ConnectionStatusBanner` | `src/components/ui/ConnectionStatusBanner.tsx` | Thin sticky banner at top of viewport. Shows state-specific text, icon, and colour. |

The `ConnectionStatusBanner` renders for **all** non-connected states
(`disconnected`, `connecting`, `authenticating`, `reconnecting`, `displaced`).
It returns `null` when `status === 'connected'`.

---

## Related Documentation

- [Streaming Architecture](streaming-architecture.md) — full backend + frontend architecture
- [Wire Protocol](wire-protocol.md) — binary framing spec
- [Notification System](notification-system.md) — first-class consumer of the streaming infrastructure
- [How to: Add a Stream Type](how-to/add-streamtype.md) — step-by-step guide
- [How to: Add a Notification Payload](how-to/add-notification-payload.md) — end-to-end notification type guide
