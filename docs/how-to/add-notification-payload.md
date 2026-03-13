# How to Add a New Notification Payload

Step-by-step guide for adding a new notification type end-to-end, from backend
enum variant to frontend toast display.

> **Related docs:**
> [Notification System](../notification-system.md) ·
> [Streaming Architecture](../streaming-architecture.md) ·
> [How to: Add a Stream Type](add-streamtype.md)

## Table of Contents

- [Overview](#overview)
- [Step 1 — Add the Backend Variant](#step-1--add-the-backend-variant)
- [Step 2 — Add the Frontend Variant](#step-2--add-the-frontend-variant)
- [Step 3 — Extend resolveDisplayText](#step-3--extend-resolvedisplaytext)
- [Step 4 — Extend getClickAction](#step-4--extend-getclickaction)
- [Step 5 — Send from Backend](#step-5--send-from-backend)
- [Step 6 — Verify with debugNotify](#step-6--verify-with-debugnotify)
- [Checklist](#checklist)

---

## Overview

Adding a new notification type touches **4 files** (2 backend, 2 frontend),
plus the route handler that triggers the notification:

```
Backend                                       Frontend
───────                                       ────────
1. NotificationPayload variant               2. NotificationPayload union
   (backend/src/notifications/mod.rs)           (frontend/src/stream/types.ts)

5. Send from route handler                   3. resolveDisplayText() branch
   (your feature's router)                      (frontend/src/contexts/
                                                  NotificationContext.tsx)

                                              4. getClickAction() branch
                                                 (frontend/src/contexts/
                                                   NotificationContext.tsx)
```

No database migration is needed — the `notifications` table stores payloads
as `CborBlob<NotificationPayload>`, so new enum variants are automatically
supported. Existing stored notifications with old variants remain valid.

---

## Step 1 — Add the Backend Variant

**File:** `backend/src/notifications/mod.rs`

Add a new variant to the `NotificationPayload` enum. The following
example shows how the enum would look **after** adding a `FriendRequest`
variant:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum NotificationPayload {
    /// Client successfully connected to the server's streaming infrastructure.
    ServerHello,

    /// A friend request was received.
    FriendRequest {
        invitation_id: i32,
        sender_id: i32,
    },
}
```

### Rules for Payload Variants

- **Must implement both `Serialize` and `Deserialize`** — payloads are stored
  as CBOR blobs in the DB for offline delivery, then deserialized later.
- **Keep fields lightweight** — avoid large blobs; use IDs to reference
  entities that the frontend can fetch separately.
- **Be forward-compatible** — once a variant is shipped, changing its fields
  is a breaking change for stored notifications. Add new variants instead.
- **Use serde defaults** for optional fields added later:
  ```rust
  FriendRequest {
      invitation_id: i32,
      sender_id: i32,
      #[serde(default)]
      message: Option<String>,  // added later, safe for old rows
  },
  ```

### Wire Encoding

Serde's externally-tagged encoding (the default) produces:

| Variant | Wire (CBOR) |
|---------|-------------|
| `ServerHello` | `"ServerHello"` |
| `FriendRequest { invitation_id: 1, sender_id: 42 }` | `{"FriendRequest": {"invitation_id": 1, "sender_id": 42}}` |

---

## Step 2 — Add the Frontend Variant

**File:** `frontend/src/stream/types.ts`

Extend the `NotificationPayload` TypeScript type to match the new Rust
variant. Here's how the type would look **after** adding the variant:

```typescript
export type NotificationPayload =
    | 'ServerHello'
    | { FriendRequest: { invitation_id: number; sender_id: number } };
```

### Matching Rules

| Rust variant type | TypeScript equivalent |
|------------------|-----------------------|
| Unit variant (`ServerHello`) | String literal (`'ServerHello'`) |
| Struct variant (`FriendRequest { … }`) | Object type (`{ FriendRequest: { … } }`) |
| Newtype variant (`Score(i32)`) | Object type (`{ Score: number }`) |

This mirrors serde's externally-tagged enum encoding. The `WireNotification`
interface uses this type:

```typescript
export interface WireNotification {
    payload: NotificationPayload;
    created_at: string;  // ISO-8601
}
```

---

## Step 3 — Extend resolveDisplayText

**File:** `frontend/src/contexts/NotificationContext.tsx`

Add an async display-text mapping for the new payload variant. This function
can fetch user nicknames via the `userResolver` API — the result is stored
in `ToastNotification.displayText` so the render path stays synchronous.

```typescript
import { getNickname } from '../api/userResolver';

async function resolveDisplayText(
    payload: NotificationPayload,
): Promise<string> {
    if (payload === 'ServerHello') return 'Connected to server';

    // New:
    if (typeof payload === 'object' && 'FriendRequest' in payload) {
        const name = await getNickname(payload.FriendRequest.sender_id);
        return `Friend request from ${name}`;
    }

    return String(payload);
}
```

### Guidelines

- Keep the text concise — it appears in a 72px-high card.
- Use `getNickname()` from `frontend/src/api/userResolver.ts` to resolve
  user IDs. It never throws — on error it returns `'#<userId>'`.
- The fallback `return String(payload)` handles unknown variants gracefully.
- Display text is resolved **before** the toast is shown (via the
  preparation queue), so the user never sees a loading state.

---

## Step 4 — Extend getClickAction

**File:** `frontend/src/contexts/NotificationContext.tsx`

Add payload-specific click behaviour in `getClickAction()`:

```typescript
function getClickAction(
    payload: NotificationPayload,
): (() => void) | null {
    // New: FriendRequest → navigate to friend requests page on click
    if (typeof payload === 'object' && 'FriendRequest' in payload) {
        return () => {
            // Navigate to friend requests or open a modal
            window.location.hash = '#/friends/requests';
        };
    }

    // Default: no special action
    return null;
}
```

### When onClick is non-null

- The toast card shows a right-chevron action button.
- Clicking the chevron fires `onClick()` without dismissing the toast.
- Clicking anywhere else on the card dismisses the toast.

### When onClick is null

- No action button is shown.
- Clicking anywhere on the card dismisses it.

---

## Step 5 — Send from Backend

Call `notification_manager.send()` from your route handler.

> **Note:** `depot.user()`, `depot.db()`, and `json_ok()` are project-specific
> helpers. `depot.user()` and `depot.db()` come from Depot extension traits
> (`DepotUserExt`, `DepotDatabaseExt` — imported via the prelude). `json_ok()`
> is a utility that wraps a value in `JsonResult::Ok`. If your handler file
> already uses `use crate::prelude::*;`, only the `NotificationPayload` import
> is needed.

```rust
use crate::notifications::NotificationPayload;

#[endpoint]
async fn send_friend_request(
    depot: &mut Depot,
    json: JsonBody<FriendRequestInput>,
) -> JsonResult<()> {
    let current_user = depot.user();
    let input = json.into_inner();

    // ... create the friend request in the DB ...
    let invitation = create_invitation(depot.db(), current_user.id, input.target_user_id).await?;

    // Notify the target user
    depot
        .notification_manager()
        .send(
            depot.db(),
            input.target_user_id,
            NotificationPayload::FriendRequest {
                invitation_id: invitation.id,
                sender_id: current_user.id,
            },
        )
        .await?;

    json_ok(())
}
```

### Delivery Behaviour

- If `target_user_id` has an open notification stream → sent immediately.
- If offline → stored in the `notifications` table as a CBOR blob.
- On next connect → drained and delivered automatically.

See [Notification System — Send-or-Store Pattern](../notification-system.md#send-or-store-pattern)
for details.

---

## Step 6 — Verify with debugNotify

In development builds, use the `window.debugNotify()` helper to test the
toast UI without needing a backend:

```javascript
// In browser console:

// 1. Basic test — triggers a ServerHello toast:
debugNotify()

// 2. Test with click action:
debugNotify("clicked!")  // alerts "clicked!" when toast is clicked
```

To test a **custom payload** (e.g. your new `FriendRequest`), temporarily
modify the `debugNotify` implementation in `NotificationContext.tsx`:

```typescript
// In NotificationContext.tsx, inside the debugNotify useEffect:
w.debugNotify = (message?: string) => {
    const notification: WireNotification = {
        // Change the payload to your new variant:
        payload: { FriendRequest: { invitation_id: 1, sender_id: 42 } },
        created_at: new Date().toISOString(),
    };
    // Goes through the same async preparation queue as real notifications:
    const prepared = prepareToast(notification).then((toast) => {
        if (message) toast.onClick = () => alert(message);
        return toast;
    });
    queueRef.current.push(prepared);
    drainQueue();
};
```

This lets you verify that `resolveDisplayText()` returns the right text
(including any resolved nicknames) and that `getClickAction()` attaches
the correct `onClick` behaviour.

For full end-to-end testing, trigger the notification from the backend
(e.g., via a REST API call) and verify:

1. Toast appears with the correct text from `resolveDisplayText()`.
2. Click action fires correctly (if `onClick` was set in `getClickAction()`).
3. Toast dismisses with slide-out animation.
4. Offline delivery: disconnect, trigger notification, reconnect — verify
   the notification arrives from the DB backlog.

---

## Checklist

Use this checklist when adding a new notification type:

- [ ] **Backend `NotificationPayload` variant** — added to enum in
      `backend/src/notifications/mod.rs` with `Serialize + Deserialize`
- [ ] **Frontend `NotificationPayload` type** — updated union in
      `frontend/src/stream/types.ts`
- [ ] **`resolveDisplayText()`** — added display text branch (with
      `getNickname()` if needed) in
      `frontend/src/contexts/NotificationContext.tsx`
- [ ] **`getClickAction()`** — added `onClick` behaviour (or confirmed default
      null is correct) in `frontend/src/contexts/NotificationContext.tsx`
- [ ] **Backend sender** — `notification_manager.send()` called from the
      relevant route handler
- [ ] **Tested live delivery** — notification appears as toast when user is
      online
- [ ] **Tested offline delivery** — notification is stored and drained on
      reconnect
- [ ] **Tested `debugNotify()`** — toast renders correctly in dev console
