# How to Add a New StreamType

Step-by-step guide for adding a new kind of WebTransport stream, end-to-end.
Uses the existing **Notifications** stream as the reference implementation.

> **Related docs:**
> [Streaming Architecture](../streaming-architecture.md) ·
> [Wire Protocol](../wire-protocol.md) ·
> [Frontend Stream Integration](../frontend-stream-integration.md) ·
> [Notification System](../notification-system.md)

## Table of Contents

- [Overview](#overview)
- [Step 1 — Add the Backend StreamType Variant](#step-1--add-the-backend-streamtype-variant)
- [Step 2 — Create the Backend Manager](#step-2--create-the-backend-manager)
- [Step 3 — Hook into on\_connect()](#step-3--hook-into-on_connect)
- [Step 4 — Add the Frontend Types](#step-4--add-the-frontend-types)
- [Step 5 — Register the Frontend Handler](#step-5--register-the-frontend-handler)
- [Step 6 — Wire Up React State](#step-6--wire-up-react-state)
- [Checklist](#checklist)

---

## Overview

Adding a new stream kind touches **4 files** minimum (2 backend, 2 frontend),
plus optional React context/components if the data drives UI.

```
Backend                           Frontend
───────                           ────────
1. StreamType variant             4. StreamType union
2. Manager module                 5. Handler registration
3. on_connect() hookup            6. React context (optional)
```

---

## Step 1 — Add the Backend StreamType Variant

**File:** `backend/src/stream/mod.rs`

Add a new variant to the `StreamType` enum. This value is serialized as CBOR
and sent as the first frame on every stream of this kind.

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub enum StreamType {
    Ctrl(PendingConnectionKey),
    Notifications,
    ChatRoom(i32),          // ← new variant (carries a room ID)
}
```

**Rules:**

- **Unit variants** (e.g. `Notifications`) — no associated data. On the wire:
  `"Notifications"`.
- **Newtype variants** (e.g. `ChatRoom(i32)`) — carry one value. On the wire:
  `{ "ChatRoom": 42 }`.
- **Struct variants** (e.g. `Game { id: Ulid, mode: Mode }`) — carry named
  fields. On the wire: `{ "Game": { "id": "...", "mode": "..." } }`.

The existing `parseStreamType()` on the frontend handles all three formats
automatically.

---

## Step 2 — Create the Backend Manager

Model your manager on `backend/src/notifications/manager.rs`. The pattern is:

1. **State map** — `DashMap<i32, SharedSender<YourWireType>>` keyed by
   `user_id`.
2. **`open_stream()`** — requests a stream from `StreamManager`, performs any
   startup work, and registers the sender.
3. **`send()`** — tries the open stream first, falls back to persistence or
   drops on error.
4. **`close_stream()`** — removes the sender on disconnect.

### Minimal Example

Create `backend/src/chat/manager.rs`:

```rust
use std::sync::Arc;
use dashmap::DashMap;
use crate::stream::{Sender, SharedSender, StreamManager, StreamType};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    pub from: i32,
    pub text: String,
    pub sent_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct ChatManager {
    /// user_id → sender for their chat stream
    streams: Arc<DashMap<i32, SharedSender<ChatMessage>, ahash::RandomState>>,
}

impl ChatManager {
    pub fn new() -> Self {
        Self { streams: Arc::new(DashMap::default()) }
    }

    pub async fn open_stream(
        &self,
        streams: &StreamManager,
        user_id: i32,
        room_id: i32,
    ) -> anyhow::Result<()> {
        let sender = streams
            .request_uni_stream::<ChatMessage>(user_id, StreamType::ChatRoom(room_id))
            .await?;
        self.streams.insert(user_id, SharedSender::new(sender));
        Ok(())
    }

    pub async fn send(&self, user_id: i32, msg: ChatMessage) -> anyhow::Result<()> {
        if let Some(sender) = self.streams.get(&user_id).map(|s| s.clone()) {
            sender.send(msg).await.map_err(|e| anyhow::anyhow!(e))?;
        }
        Ok(())
    }

    pub fn close_stream(&self, user_id: i32) {
        self.streams.remove(&user_id);
    }
}
```

### Bidirectional Streams

If the client needs to send data back (e.g. chat input), use
`request_stream()` instead of `request_uni_stream()`. This returns both a
`Sender<TSend>` and a `Receiver<TRecv>`. Spawn a task to read from the
receiver.

### Depot Integration

Add an extension trait (like `NotificationManagerDepotExt`) and inject the
manager via `affix_state::inject(ChatManager::new())` in the router.

---

## Step 3 — Hook into on_connect()

**File:** `backend/src/stream/mod.rs`

Call your manager's `open_stream()` from the `on_connect()` function. This
runs once per WebTransport session after the auth handshake succeeds.

```rust
async fn on_connect(
    user_id: i32,
    db: &Db,
    streams: &StreamManager,
    depot: &mut Depot,
) -> anyhow::Result<()> {
    // Existing:
    depot.notification_manager()
        .open_stream(db, streams, user_id).await?;

    // New:
    depot.chat_manager()
        .open_stream(streams, user_id, default_room_id).await?;

    // ...
    Ok(())
}
```

**Important:** If `on_connect()` returns `Err`, the connection is closed and
the error is logged. Keep the function infallible for non-critical features
by handling errors gracefully within each manager.

---

## Step 4 — Add the Frontend Types

**File:** `frontend/src/stream/types.ts`

### 4a. Extend the StreamType Union

```typescript
export type StreamType =
    | 'Notifications'
    | { Ctrl: PendingConnectionKey }
    | { ChatRoom: number };          // ← add this
```

This type is used for documentation / tooling. The actual dispatch uses the
string key from `parseStreamType()`, so even if you forget to update this
union the runtime still works.

### 4b. Define the Wire Types

Add the message type matching the backend struct:

```typescript
export interface ChatMessage {
    from: number;
    text: string;
    sent_at: string;  // ISO-8601
}
```

---

## Step 5 — Register the Frontend Handler

**File:** Your new context or hook.

Use `connectionManager.registerUniHandler()` (or `registerBidiHandler()`) to
subscribe to streams of your new type. The key is the **variant name** as a
string. You register a **factory function** that is called once per incoming
stream, returning a fresh handler instance. This means multiple streams of the
same type (e.g., several `ChatRoom` streams for different rooms) each get their
own handler with independent state.

```typescript
import type { UniStreamHandler, ChatMessage } from '../stream/types';

connectionManager.registerUniHandler('ChatRoom', (data) => {
    // `data` is the variant payload — for ChatRoom, it's the room ID (42)
    console.log('Joined chat room:', data);

    return {
        onOpen() {
            // stream is ready (data was already received via the factory)
        },
        onMessage(msg: ChatMessage) {
            // Append to state
            setMessages(prev => [...prev, msg]);
        },
        onClose() {
            console.log('Chat stream closed');
        },
        onError(err) {
            console.warn('Chat stream error:', err);
        },
    };
});

// On cleanup:
connectionManager.unregisterHandler('ChatRoom');
```

### Handler Lifecycle

- **Factory `(data) => handler`** — called once per incoming stream after the
  `StreamType` header is decoded. `data` is the variant payload (`undefined`
  for unit variants like `"Notifications"`, the inner value for newtype
  variants like `{ "ChatRoom": 42 }`, where `data = 42`). For bidi streams
  the factory also receives `send`.
- **`onOpen()`** — called once on the new handler instance, immediately after
  the factory returns. Takes no arguments (data and send are already available
  in the factory closure).
- **`onMessage(msg)`** — called for each subsequent frame.
- **`onClose()`** — stream ended normally.
- **`onError(err)`** — stream errored out.

---

## Step 6 — Wire Up React State

Create a React context that wraps the handler registration, following the
`NotificationContext` pattern:

```
frontend/src/contexts/ChatContext.tsx
```

The pattern:

1. **Create context** with your state shape.
2. **`useEffect`** — register the handler on mount, unregister on unmount.
3. **State** — update via `useState` setters inside `onMessage`.
4. **Provider** — nest inside `StreamProvider` in `App.tsx`.
5. **Hook** — `useChat()` exposes state to components.

### Provider Nesting Order (App.tsx)

```tsx
<AuthProvider>
  <StreamProvider>
    <NotificationProvider>
      <ChatProvider>          {/* ← add yours here */}
        <AppRoutes />
        <NotificationToast />
      </ChatProvider>
    </NotificationProvider>
  </StreamProvider>
</AuthProvider>
```

Order rule: providers that depend on `useStream()` go inside `StreamProvider`.
Providers are independent of each other and can be in any order among
siblings.

---

## Checklist

Use this checklist when adding a new stream type:

- [ ] **Backend `StreamType` variant** — added to enum in
      `backend/src/stream/mod.rs`
- [ ] **Backend manager** — created (or extended existing) with
      `open_stream()` / `send()` / `close_stream()`
- [ ] **Depot extension trait** — added and manager injected via
      `affix_state::inject()`
- [ ] **`on_connect()` hookup** — manager's `open_stream()` called
- [ ] **Frontend `StreamType` union** — updated in
      `frontend/src/stream/types.ts`
- [ ] **Frontend wire type** — struct/interface defined in
      `frontend/src/stream/types.ts`
- [ ] **Frontend handler** — factory registered via
      `connectionManager.registerUniHandler()` or `.registerBidiHandler()`
- [ ] **React context** — created (if UI needed), nested in `App.tsx`
- [ ] **Tests** — backend: stream opens, sends, recovers on disconnect;
      frontend: handler receives correctly typed messages
