# Notification System

Real-time notification delivery over WebTransport with offline persistence.
The notification system is a first-class consumer of the
[streaming infrastructure](streaming-architecture.md), demonstrating the
send-or-store pattern that guarantees delivery regardless of user connectivity.

## Table of Contents

- [Notification System](#notification-system)
	- [Table of Contents](#table-of-contents)
	- [Design Overview](#design-overview)
		- [Why This Pattern](#why-this-pattern)
	- [Send-or-Store Pattern](#send-or-store-pattern)
		- [Insert-Before-Drain Ordering](#insert-before-drain-ordering)
		- [Graceful Drain Failure](#graceful-drain-failure)
	- [Backend Implementation](#backend-implementation)
		- [NotificationManager](#notificationmanager)
			- [Public API](#public-api)
			- [Private Methods](#private-methods)
			- [Error Types](#error-types)
			- [Internal State](#internal-state)
		- [Types \& Payloads](#types--payloads)
			- [NotificationPayload](#notificationpayload)
			- [WireNotification](#wirenotification)
			- [NotificationManagerDepotExt](#notificationmanagerdepotext)
		- [Database Schema](#database-schema)
			- [Diesel Models](#diesel-models)
		- [Integration with Streaming](#integration-with-streaming)
	- [Frontend Implementation](#frontend-implementation)
		- [User Resolver API](#user-resolver-api)
		- [NotificationContext](#notificationcontext)
			- [Handler Registration \& Preparation Queue](#handler-registration--preparation-queue)
			- [resolveDisplayText](#resolvedisplaytext)
			- [getClickAction](#getclickaction)
			- [prepareToast](#preparetoast)
			- [ToastNotification Interface](#toastnotification-interface)
			- [useNotifications Hook](#usenotifications-hook)
			- [Debug Helper](#debug-helper)
		- [NotificationToast](#notificationtoast)
			- [Layout Algorithm](#layout-algorithm)
			- [Display Modes](#display-modes)
			- [Animations](#animations)
			- [Card Content](#card-content)
		- [Provider Hierarchy](#provider-hierarchy)
	- [End-to-End Lifecycle](#end-to-end-lifecycle)
		- [Reconnection \& Backlog Drain](#reconnection--backlog-drain)
	- [Delivery Guarantees](#delivery-guarantees)
	- [Extending the System](#extending-the-system)
		- [Adding a New Notification Type](#adding-a-new-notification-type)
		- [Sending from a Route Handler](#sending-from-a-route-handler)
	- [Related Documentation](#related-documentation)

---

## Design Overview

The notification system solves a common real-time messaging problem: how to
deliver notifications to users who may or may not be online, with zero message
loss and minimal latency.

```
                          ┌──────────────────────────────────┐
                          │        NotificationManager        │
                          │         (backend, Rust)           │
                          └──────────┬───────────┬───────────┘
                                     │           │
              User online?          YES          NO
                                     │           │
                          ┌──────────┴──┐   ┌────┴──────────┐
                          │  Send via   │   │  Persist to   │
                          │ WebTransport│   │  SQLite DB    │
                          │ uni stream  │   │  (CBOR blob)  │
                          └──────┬──────┘   └───────┬───────┘
                                 │                  │
                                 │          On next connect:
                                 │          drain DB → stream
                                 │                  │
                          ┌──────┴──────────────────┴───────┐
                          │  Frontend NotificationContext    │
                          │  → WireNotification[] state      │
                          │  → ToastNotification[] toasts    │
                          └──────────────┬──────────────────┘
                                         │
                          ┌──────────────┴──────────────────┐
                          │     NotificationToast UI         │
                          │  Multi-card stack, bottom-left    │
                          └─────────────────────────────────┘
```

### Why This Pattern

| Requirement | How it's met |
|-------------|-------------|
| **Low latency for online users** | Direct WebTransport delivery — zero DB round-trip |
| **Offline delivery guarantee** | Persisted to SQLite when no stream is open |
| **No duplicate delivery** | Insert-before-drain ordering (see below) |
| **Graceful partial failure** | Unsent notifications re-persisted on drain failure |
| **Extensible payloads** | `NotificationPayload` enum — add variants freely |

---

## Send-or-Store Pattern

The core delivery algorithm in `NotificationManager::send()`:

```
send(db, user_id, payload)
    │
    ├─ User has open notification stream?
    │     │
    │     YES ──► Try sending via SharedSender
    │     │         │
    │     │         ├─ Success → return Ok (zero DB round-trip)
    │     │         │
    │     │         └─ Channel closed → remove stale sender
    │     │              │
    │     │              └─ Fall through to DB storage ▼
    │     │
    │     NO
    │
    └─ Store to DB:
         INSERT INTO notifications (user_id, data, created_at)
         data = CborBlob<NotificationPayload>
```

### Insert-Before-Drain Ordering

When a user connects and `open_stream()` is called, the sender is registered
in the `DashMap` **before** draining the DB backlog. This is critical:

```
open_stream(db, streams, user_id)
    │
    ├─ 1. Request uni stream from StreamManager
    │     → sends StreamType::Notifications header
    │     → returns Sender<WireNotification>
    │
    ├─ 2. Wrap in SharedSender (cloneable, spawns mpsc forwarding task)
    │
    ├─ 3. Register sender in DashMap  ◄── BEFORE draining
    │
    └─ 4. Drain DB backlog (oldest → newest)
          SELECT + DELETE in single transaction
          Send each stored notification over the stream
          If send fails mid-drain: re-store unsent notifications
```

**Why register before drain?** If a concurrent `send()` call arrives while
we're draining, it finds the sender in the map and writes directly to the
stream — instead of falling back to the DB and creating a notification that
won't be delivered until the *next* reconnect. This might deliver a new
notification before older backlog items, but every notification carries a
`created_at` timestamp so the client can sort by time if strict ordering
is required.

### Graceful Drain Failure

If the stream breaks mid-drain (e.g., client disconnects), the remaining
unsent `OfflineNotification` rows are re-inserted into the DB via
`store_back_to_db()`. The sender is also removed from the map so subsequent
`send()` calls fall back to DB storage correctly.

---

## Backend Implementation

### NotificationManager

**File:** `backend/src/notifications/manager.rs` (~250 lines)

A cheaply cloneable (`Arc`-backed) manager injected into the Salvo router via
`affix_state::inject(NotificationManager::new())`. Retrieved from the depot
using the `NotificationManagerDepotExt` trait.

#### Public API

| Method | Signature | Purpose |
|--------|-----------|---------|
| `new()` | `fn new() -> Self` | Constructor with empty `DashMap`. |
| `send()` | `async fn send(&self, db: &Db, user_id: i32, payload: NotificationPayload) -> Result<()>` | Send-or-store delivery. Tries open stream first; on failure cleans up stale sender, falls back to DB. |
| `open_stream()` | `async fn open_stream(&self, db: &Db, streams: &StreamManager, user_id: i32) -> Result<()>` | Opens uni stream, drains DB backlog, registers sender. Insert-before-drain pattern. |
| `close_stream()` | `fn close_stream(&self, user_id: i32)` | Removes sender from map (e.g. on disconnect). |
| `has_stream()` | `fn has_stream(&self, user_id: i32) -> bool` | Checks if user has an active notification stream. |

#### Private Methods

| Method | Purpose |
|--------|---------|
| `store_to_db()` | Inserts a `NewOfflineNotification` with `CborBlob<NotificationPayload>`. |
| `drain_from_db()` | Loads and deletes all rows for `user_id` (oldest first) in a single write transaction. |
| `store_back_to_db()` | Re-inserts a `SmallVec` of `OfflineNotification` rows that couldn't be sent during drain. |

#### Error Types

```rust
#[derive(Debug, Error)]
pub enum NotificationError {
    /// The underlying WebTransport stream is gone.
    Stream(#[from] StreamManagerError),

    /// A database operation failed.
    Db(#[from] DbError),

    /// Sending over an already-open stream failed (codec / transport error).
    Send { user_id: i32, reason: String },
}
```

#### Internal State

```rust
pub struct NotificationManager {
    /// Active notification streams keyed by user_id.
    streams: Arc<DashMap<i32, SharedSender<WireNotification>, ahash::RandomState>>,
}
```

The `DashMap` provides concurrent access from multiple async tasks without
external locking. `SharedSender<T>` is a thin wrapper around `mpsc::Sender<T>`
that spawns a forwarding task to the actual `Sender<T>` (codec-framed
WebTransport stream). It is cloneable and supports equality comparison via
`same_channel()`.

### Types & Payloads

**File:** `backend/src/notifications/mod.rs` (~80 lines)

#### NotificationPayload

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum NotificationPayload {
    /// Client successfully connected to the server's streaming infrastructure.
    ServerHello,
    // Future examples:
    // FriendRequest { invitation_id: i32, sender_id: i32 },
    // GameInvite { game_id: Ulid, from_user_id: i32 },
}
```

This enum is:
- **Serialized to CBOR** for wire transmission (via `serde::Serialize`)
- **Stored as a CBOR blob** in SQLite for offline persistence (via `CborBlob<NotificationPayload>`)
- **Deserialized** on both sides (via `serde::Deserialize`)

Serde's externally-tagged encoding means unit variants serialize as strings
(`"ServerHello"`) and struct variants as single-key objects
(`{"FriendRequest": {"invitation_id": 1, "sender_id": 2}}`).

#### WireNotification

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireNotification {
    pub payload: NotificationPayload,
    pub created_at: DateTime<Utc>,  // ISO-8601 on the wire
}
```

This is the on-the-wire format sent to the frontend. The `created_at`
timestamp is set either at send time (for live delivery) or preserved from
the original storage time (for drained offline notifications).

#### NotificationManagerDepotExt

```rust
pub trait NotificationManagerDepotExt {
    fn notification_manager(&self) -> &NotificationManager;
}
```

Extension trait on Salvo's `Depot` for ergonomic access. Panics if
`affix_state::inject(NotificationManager::new())` was not registered upstream.

### Database Schema

**Migration:** `backend/migrations/2026-02-13-162014-0000_create_notifications/up.sql`

```sql
CREATE TABLE notifications (
    id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    data        BLOB NOT NULL,  -- CborBlob<NotificationPayload>
    created_at  DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_user_created_at ON notifications (user_id, created_at);
```

The index on `(user_id, created_at)` optimizes the drain query which filters
by `user_id` and orders by `created_at ASC`.

#### Diesel Models

**File:** `backend/src/models.rs`

```rust
/// Notification Database model for offline notifications
#[derive(Queryable, Selectable, Associations, AsChangeset, Debug, Clone)]
#[diesel(belongs_to(User))]
#[diesel(table_name = crate::schema::notifications)]
pub struct OfflineNotification {
    pub id: i32,
    pub user_id: i32,
    pub data: CborBlob<NotificationPayload>,
    pub created_at: DateTime<Utc>,
}
```

`CborBlob<T>` is a custom Diesel type that transparently serializes `T` to
CBOR bytes on insert and deserializes on load. This means the `data` column
stores the raw CBOR encoding of `NotificationPayload`, which is compact and
robust for long-term storage.

`NewOfflineNotification` (generated by `diesel_autoincrement_new_struct`)
omits the `id` field for insertion.

### Integration with Streaming

**File:** `backend/src/stream/mod.rs`

The notification system hooks into the streaming lifecycle via `on_connect()`:

```rust
async fn on_connect(
    user_id: i32,
    db: &Db,
    streams: &StreamManager,
    depot: &mut Depot,
) -> anyhow::Result<()> {
    // Open the notification uni stream + drain offline backlog
    depot
        .notification_manager()
        .open_stream(db, streams, user_id)
        .await?;

    // Send a welcome notification
    depot
        .notification_manager()
        .send(db, user_id, NotificationPayload::ServerHello)
        .await?;
    Ok(())
}
```

This function is called after the two-step auth handshake completes. It runs
concurrently with the command loop (via `tokio::select!`) so that stream
requests from `open_stream()` can be fulfilled immediately. See
[Streaming Architecture](streaming-architecture.md#auth-handshake-deep-dive)
for details.

---

## Frontend Implementation

### User Resolver API

**File:** `frontend/src/api/userResolver.ts`

An internal async API for resolving user IDs ↔ nicknames. Hides the
transport layer (REST today, potentially a WebTransport stream or
client-side cache in the future) behind a stable interface.

| Function | Signature | Behaviour |
|----------|-----------|----------|
| `getNickname()` | `(userId: number) => Promise<string>` | Resolves via `POST /api/users/nickname`. Returns `'#<userId>'` (e.g. `'#57'`) on any error — **never throws**. |
| `getUserId()` | `(nickname: string) => Promise<number>` | Resolves via `POST /api/users/by-nickname`. Handles fallback nicks like `'#57'` by extracting the numeric ID directly (no network call). **Throws** if not found. |
| `getNicknames()` | `(userIds: number[]) => Promise<Map<number, string>>` | Batch version of `getNickname()`. Missing IDs get the `'#<id>'` fallback. |

The fallback convention `'#<id>'` creates a round-trip invariant:
`getUserId(await getNickname(id))` always returns `id`, even when the
nickname request failed — because `getUserId('#57')` parses out `57`
without a network call.

### NotificationContext

**File:** `frontend/src/contexts/NotificationContext.tsx` (~220 lines)

The React context that bridges the streaming infrastructure to notification
UI components.

#### Handler Registration & Preparation Queue

On mount, registers a `UniHandlerFactory<WireNotification>` for the
`"Notifications"` stream type. Incoming notifications are **prepared
asynchronously** (display text resolved — e.g. nickname lookups) before
being shown as toasts.

```typescript
// Handler pushes a preparation promise per notification:
onMessage(notification: WireNotification) {
    enqueueNotification(notification);
}

// enqueueNotification starts async work immediately:
const enqueueNotification = useCallback(
    (notification: WireNotification) => {
        queueRef.current.push(prepareToast(notification));
        drainQueue();
    },
    [drainQueue],
);
```

The **preparation queue** guarantees ordered display with concurrent
resolution:

1. Each incoming notification immediately starts async preparation
   (e.g. fetching a nickname via `userResolver`).
2. The preparation `Promise` is pushed to a FIFO queue.
3. `drainQueue()` awaits each promise in order — so a slow lookup on
   notification #1 never lets notification #2 leapfrog it.
4. Once resolved, the toast (with pre-baked `displayText`) is appended
   to React state.

```typescript
const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;

    while (queueRef.current.length > 0) {
        const promise = queueRef.current.shift()!;
        try {
            const toast = await promise;
            setNotifications((prev) => [toast.notification, ...prev]);
            setActiveToasts((prev) => [toast, ...prev]);
        } catch (err) {
            console.warn('[Notifications] failed to prepare toast:', err);
        }
    }

    drainingRef.current = false;
}, []);
```

#### resolveDisplayText

```typescript
async function resolveDisplayText(
    payload: NotificationPayload,
): Promise<string> {
    if (payload === 'ServerHello') return 'Connected to server';

    // Future variants with user IDs resolve nicknames here:
    // if (typeof payload === 'object' && 'FriendRequest' in payload) {
    //     const name = await getNickname(payload.FriendRequest.sender_id);
    //     return `Friend request from ${name}`;
    // }

    return String(payload);
}
```

This is the **async replacement** for the old synchronous
`formatNotification`. Because the display text is resolved *before* the
toast enters `activeToasts`, the render path stays fully synchronous —
no loading states, no flicker.

#### getClickAction

```typescript
function getClickAction(
    _payload: NotificationPayload,
): (() => void) | null {
    // Extend per payload type. Example:
    // if (typeof payload === 'object' && 'FriendRequest' in payload) {
    //     return () => window.location.hash = '#/friends/requests';
    // }
    return null;
}
```

Determines the click action for a payload. When non-null, the toast is
visually marked as "actionable" (shows a chevron button).

#### prepareToast

```typescript
async function prepareToast(
    notification: WireNotification,
): Promise<ToastNotification> {
    const displayText = await resolveDisplayText(notification.payload);
    return {
        id: crypto.randomUUID(),
        notification,
        displayText,
        onClick: getClickAction(notification.payload),
    };
}
```

Builds a fully-prepared toast with pre-resolved display text. The returned
promise is placed in the preparation queue for ordered display.

#### ToastNotification Interface

```typescript
export interface ToastNotification {
    /** Stable unique identifier (crypto.randomUUID()). */
    id: string;
    notification: WireNotification;
    /** Pre-resolved human-readable text for this notification. */
    displayText: string;
    /** Custom click action. null = no special action. */
    onClick: (() => void) | null;
}
```

#### useNotifications Hook

```typescript
const { notifications, activeToasts, dismissToast } = useNotifications();
```

| Property | Type | Description |
|----------|------|-------------|
| `notifications` | `WireNotification[]` | All notifications received this session (newest first) |
| `activeToasts` | `ToastNotification[]` | Undismissed toasts (newest first) |
| `dismissToast` | `(id: string) => void` | Remove a toast from the active list |

#### Debug Helper

In development builds (`import.meta.env.DEV`), `window.debugNotify()` is
registered for browser console testing. It goes through the same async
preparation queue as real notifications:

```javascript
// Plain toast (ServerHello):
debugNotify()

// Toast with custom click action:
debugNotify("hello")  // alerts "hello" on click
```

### NotificationToast

**File:** `frontend/src/components/ui/NotificationToast.tsx` (~270 lines)

Multi-toast notification stack anchored to the bottom-left corner of the
viewport.

#### Layout Algorithm

| Constant | Value | Description |
|----------|-------|-------------|
| `CARD_H` | 72 | Card height in px (matches `h-[4.5rem]`) |
| `GAP` | 12 | Gap between individually displayed cards |
| `STRIDE` | 84 | Total vertical stride per card slot (`CARD_H + GAP`) |
| `STACK_PEEK` | 8 | Peek distance between stacked slivers |
| `MAX_INDIVIDUAL` | 2 | Max cards shown individually before stack mode |
| `MAX_STACK_VISUAL` | 3 | Max visual cards inside the stack |
| `MAX_VISIBLE` | 4 | Max visible items overall (`1 + MAX_STACK_VISUAL`) |

#### Display Modes

**Individual mode** (≤ 2 active toasts): Each toast is spaced vertically
with full interactivity.

**Stack mode** (> 2 active toasts): The newest toast stays at the top with
full size. A stack of older toasts appears below, with the topmost stack card
readable and deeper cards rendered as decorative slivers with progressive
downscaling (`scale = 1 - stackIdx × 0.03`). Only the newest and the
topmost stack card are interactive.

A `+N more` overflow badge appears when `activeToasts.length > MAX_VISIBLE`.

#### Animations

- **Slide-in:** `animate-toast-in` CSS animation on mount.
- **Slide-out:** `animate-toast-out` animation triggered by `animateDismiss()`,
  followed by actual removal after `SLIDE_OUT_MS` (200 ms).

#### Card Content

Each card shows:
- Bell icon + pre-resolved `toast.displayText`
- Timestamp (`created_at` formatted via `toLocaleTimeString()`)
- Optional action chevron button (if `toast.onClick` is non-null)

Clicking anywhere on the card dismisses it. The action chevron fires
`toast.onClick()` without immediately dismissing.

> **Note:** Display text is pre-resolved during async preparation in
> `NotificationContext` via `resolveDisplayText()` — the toast component
> itself is purely synchronous.

### Provider Hierarchy

```tsx
// App.tsx
<AuthProvider>
    <StreamProvider>
        <NotificationProvider>
            <AppRoutes />
            <NotificationToast />
        </NotificationProvider>
    </StreamProvider>
</AuthProvider>
```

The nesting order is mandatory:
1. `AuthProvider` — provides user state.
2. `StreamProvider` — creates `ConnectionManager`, connects on auth.
3. `NotificationProvider` — registers notification handler on `ConnectionManager`.

`NotificationToast` is rendered inside `NotificationProvider` so it can use
`useNotifications()`.

---

## End-to-End Lifecycle

Complete flow from a backend event to a toast on the user's screen:

```
Backend route handler
    │
    ├─ depot.notification_manager()
    │      .send(db, user_id, NotificationPayload::ServerHello)
    │
    ▼
NotificationManager::send()
    │
    ├─ DashMap lookup: user has open stream?
    │     │
    │    YES ──► SharedSender.send(WireNotification { payload, created_at })
    │     │         │
    │     │         ├─ mpsc channel → forwarding task → Sender<WireNotification>
    │     │         │   → CompressedCborEncoder → CBOR frame on WebTransport uni stream
    │     │         │
    │     │         └─ Channel closed? → remove sender, fall back to DB ▼
    │     │
    │    NO
    │
    └─ store_to_db(db, user_id, payload, created_at)
         INSERT INTO notifications (user_id, data, created_at)
         data = CborBlob(ciborium::to_vec(payload))

═══════════════════════════════════════════════════════════

Frontend (browser)
    │
    ▼
ConnectionManager acceptUniStreams loop
    │
    ├─ Incoming uni stream
    ├─ Read first CBOR frame → StreamType header = "Notifications"
    ├─ Look up uniFactories.get("Notifications") → factory
    ├─ factory(undefined) → handler instance
    ├─ handler.onOpen()
    │
    ├─ Read subsequent CBOR frames → WireNotification objects
    │     │
    │     └─ handler.onMessage(wireNotification)
    │           │
    │           └─ enqueueNotification(wireNotification)
    │                 │
    │                 ├─ prepareToast(notification)  ← starts async work immediately
    │                 │     └─ resolveDisplayText(payload)
    │                 │           └─ may call getNickname(userId) etc.
    │                 │
    │                 └─ drainQueue()  ← awaits promises in FIFO order
    │                       │
    │                       ├─ toast = await promise  (displayText now resolved)
    │                       ├─ setNotifications(prev => [notification, ...prev])
    │                       └─ setActiveToasts(prev => [toast, ...prev])
    │
    └─ NotificationToast component re-renders
         │
         ├─ Visible toast cards with slide-in animation
         ├─ toast.displayText (pre-resolved, synchronous render)
         └─ Click → animateDismiss → dismissToast(id)
```

### Reconnection & Backlog Drain

When a user reconnects after being offline:

```
on_connect(user_id, db, streams, depot)
    │
    ├─ NotificationManager::open_stream(db, streams, user_id)
    │     │
    │     ├─ StreamManager.request_uni_stream(user_id, StreamType::Notifications)
    │     │   → server opens uni stream, sends "Notifications" header
    │     │   → returns Sender<WireNotification>
    │     │
    │     ├─ SharedSender::new(sender) → wraps in cloneable mpsc
    │     │
    │     ├─ DashMap.insert(user_id, sender)  ← register BEFORE drain
    │     │
    │     └─ drain_from_db(db, user_id)
    │           │
    │           ├─ SELECT * FROM notifications WHERE user_id = ?
    │           │   ORDER BY created_at ASC
    │           ├─ DELETE matching rows
    │           │   (both in single write transaction)
    │           │
    │           └─ For each OfflineNotification:
    │                 sender.send(WireNotification {
    │                     payload: notification.data.into_inner(),
    │                     created_at: notification.created_at,
    │                 })
    │                 │
    │                 └─ If send fails: store_back_to_db(remaining)
    │
    └─ NotificationManager::send(db, user_id, NotificationPayload::ServerHello)
         → goes via fast path (stream is now open)
```

---

## Delivery Guarantees

| Scenario | Behaviour |
|----------|-----------|
| **User online** | Payload sent directly via WebTransport uni stream — zero DB round-trip. |
| **User offline** | Payload persisted to `notifications` table as `CborBlob`. |
| **User reconnects** | All stored notifications drained (oldest first) and sent over new stream. |
| **Stream breaks mid-drain** | Unsent notifications re-persisted via `store_back_to_db()`. |
| **Concurrent send during drain** | New send hits the already-registered sender (insert-before-drain), goes to wire. |
| **User row deleted** | `ON DELETE CASCADE` removes all notification rows. |
| **Ordering** | Each notification carries `created_at`. Client can sort by timestamp. |

---

## Extending the System

### Adding a New Notification Type

See [How to: Add a Notification Payload](how-to/add-notification-payload.md)
for a step-by-step guide.

Quick summary:
1. Add a variant to `NotificationPayload` (Rust enum in
   `backend/src/notifications/mod.rs`).
2. Add matching variant to `NotificationPayload` (TypeScript union in
   `frontend/src/stream/types.ts`).
3. Extend `resolveDisplayText()` in `NotificationContext.tsx` — resolve
   any user IDs to nicknames via `getNickname()` from `userResolver.ts`.
4. Extend `getClickAction()` in `NotificationContext.tsx` (optional `onClick`).
5. Call `notification_manager.send(db, user_id, YourVariant)` from backend.

### Sending from a Route Handler

```rust
use crate::notifications::{NotificationManagerDepotExt, NotificationPayload};

#[endpoint]
async fn accept_friend_request(depot: &mut Depot, /* ... */) -> JsonResult<()> {
    // ... business logic ...

    // Notify the other user
    depot
        .notification_manager()
        .send(depot.db(), other_user_id, NotificationPayload::FriendRequest {
            invitation_id,
            sender_id: current_user.id,
        })
        .await?;

    json_ok(())
}
```

---

## Related Documentation

- [Streaming Architecture](streaming-architecture.md) — WebTransport
  connection lifecycle, auth handshake, stream multiplexing
- [Wire Protocol](wire-protocol.md) — binary framing, CBOR encoding, Zstd
  compression
- [Frontend Stream Integration](frontend-stream-integration.md) — handler
  pattern, codec abstraction, React bridge
- [How to: Add a Stream Type](how-to/add-streamtype.md) — adding new
  WebTransport stream types
- [How to: Add a Notification Payload](how-to/add-notification-payload.md)
  — end-to-end guide for new notification types
