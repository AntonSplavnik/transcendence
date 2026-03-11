# Chat System — Implementation Challenges

Technical challenges encountered while building the real-time chat overlay,
how each was resolved, and the trade-offs involved.

---

## 1. Pure Reducer vs Side-Effectful Timeouts

**Problem:** Typing indicators require `setTimeout` to auto-clear after ~3s,
but React reducers must be pure functions — no side effects allowed. Storing
timeout handles directly in reducer state (`typingUsers: Map<number, timeout>`)
would mean the reducer calls `clearTimeout` on updates, violating purity.

**Solution:** Split ownership. The reducer holds `typingUsers: Set<number>` —
a pure display-only set. The actual `setTimeout` handles live in a
`typingTimeoutsRef` in the context, keyed by `${roomId}:${userId}`. When
`IsTyping` arrives, the context clears the old handle, sets a new timeout
that dispatches `CLEAR_TYPING`, and stores the handle in the ref. The reducer
just adds/removes user IDs.

**Trade-off:** Two sources of truth that must stay synchronized. If the context
fails to clear a timeout, the reducer's `typingUsers` set could become stale.
We mitigate this by clearing timeouts at every boundary: new IsTyping for the
same user, NewMsg from that user, room close, RESET, and provider unmount.

---

## 2. Stale Closures in Send Callbacks

**Problem:** `sendMessage`, `sendTypingIndicator`, and `sendReadReceipt` need
access to the current `rooms` Map to look up each room's `send` function. If
these callbacks depend on `rooms` in their `useCallback` dependency array, they
get recreated on every reducer dispatch (which happens on every incoming
message). This causes unnecessary re-renders in child components like
`ChatInput`.

**Solution:** A `roomsRef` that always points to the latest `rooms` state:

```typescript
const roomsRef = useRef(rooms);
useEffect(() => { roomsRef.current = rooms; }, [rooms]);

const sendMessage = useCallback((roomId, text) => {
    const room = roomsRef.current.get(roomId);
    room?.send?.({ SendText: text });
}, []); // no rooms dependency — stable across renders
```

**Trade-off:** `roomsRef.current` is read during a callback invocation, not
during render. This is safe because send callbacks are only triggered by user
interaction (click/keypress), which always happens after React has committed
the latest state to the ref. But it does mean the send callbacks are not
reactive — they read state imperatively rather than declaratively.

---

## 3. Collapsed Feed: Detecting "New" Messages

**Problem:** The collapsed chat feed shows the last 7 messages across all rooms
with an 8-second fade-out animation. But `rooms` state contains the full
message history (replaced on reconnect via `MsgLog`). We can't just render the
last 7 messages — on reconnect, the entire history would appear as "new" and
flood the collapsed feed.

**Solution:** A `seenIdsRef: Set<string>` tracks every message ID that has been
processed. On mount, all existing message IDs are pre-populated into the set.
A `useEffect` watching `rooms` compares incoming messages against the set — only
truly new messages (IDs not in the set) get added to the `feedItems` state.
`onAnimationEnd` removes items after their 8s fade completes.

```
Mount → pre-populate seenIds with all existing message IDs
rooms change → check each message against seenIds
  → new ID found → add to feedItems (max 7), mark as seen
  → animation ends → remove from feedItems
```

**Trade-off:** The `seenIdsRef` grows unboundedly over a long session (one
entry per message ever received). In practice this is negligible — even 10,000
string ULIDs is ~260KB. A production system could periodically prune IDs older
than the oldest message in any room's current history.

---

## 4. Map as React State

**Problem:** The reducer uses `Map<string, ChatRoomState>` as its state type.
React's `useReducer` detects changes by reference equality (`Object.is`). Maps
are mutable — calling `.set()` on the same Map instance doesn't trigger a
re-render.

**Solution:** Every reducer action that modifies state returns `new Map(state)`
(a shallow copy). Inner mutable types (`Set`, `Map`) inside `ChatRoomState` are
also cloned before mutation:

```typescript
case 'IS_TYPING':
    return updateRoom(state, action.roomId, (r) => {
        const typingUsers = new Set(r.typingUsers); // clone
        typingUsers.add(action.userId);
        return { ...r, typingUsers };               // new room object
    });
```

**Trade-off:** Every action creates a new Map + at least one new room object +
cloned inner collections. For the chat use case (low-frequency updates, small
room count) this is negligible. But it means we can't use reference equality
to skip renders on individual rooms — any action touching any room creates a
new top-level Map, causing all consumers of `useChat()` to re-render. A future
optimization could use a normalized store or per-room context slicing.

---

## 5. React Rules of Hooks with Early Returns

**Problem:** `ChatOverlay` needs to return `null` when `!preferences.visible`
or `!user`. But it also uses `useEffect` (for the T-key listener),
`useCallback`, `useRef`, and `useChat()`. React's rules of hooks forbid
calling hooks conditionally or after an early return.

**Solution:** All hooks are called unconditionally at the top of the component.
The early return (`if (!preferences.visible || !user) return null`) is placed
*after* all hook calls. This satisfies the rules of hooks while still avoiding
unnecessary DOM output.

**Trade-off:** The T-key listener, refs, and callbacks are initialized even when
the chat is hidden. The overhead is trivial (a single `keydown` listener + a few
refs), but it means the component is never truly "off" — it's always listening.
This is actually desirable: the T key should work even when chat is hidden to
provide a consistent toggle experience.

---

## 6. Preventing Babylon.js Key Capture

**Problem:** The game uses Babylon.js for 3D rendering, which listens for
keyboard events (WASD, arrows, etc.) on the document. When the chat input is
focused, typing "w" should insert the character, not move the camera forward.

**Solution:** `e.stopPropagation()` on **every** `onKeyDown` event in
`ChatInput`, regardless of whether the key is handled by chat logic. This
prevents the event from bubbling up to Babylon.js's document-level listener.

```typescript
function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation(); // always — prevent Babylon.js capture
    // ... handle Enter, Escape, arrows, etc.
}
```

**Trade-off:** Any other document-level keyboard shortcut system will also be
blocked while the chat input is focused. This is the intended behaviour — when
the user is typing a message, all keyboard input belongs to the chat. The T-key
listener explicitly checks `activeElement` to avoid firing when already in an
input.

---

## 7. Bidi Handler Lifetime vs React Lifecycle

**Problem:** The `BidiHandlerFactory` registered with `ConnectionManager` is
called for each incoming bidi stream. The returned handler's `onMessage`
callback dispatches to the reducer and manages timeouts. But the factory is
registered in a `useEffect` — if the effect re-runs (e.g. `connectionManager`
changes), the old factory is unregistered and a new one is registered. Existing
stream handlers created by the old factory still hold references to the old
`dispatch` and refs.

**Solution:** All values captured by `createChatRoomHandler` are stable:
- `dispatch` from `useReducer` — guaranteed stable by React.
- `typingTimeoutsRef`, `errorClearRef` — `useRef` objects, stable by identity.
- `setChatError` — `useState` setter, guaranteed stable by React.

So even if the factory is replaced, existing handlers still work correctly
because they captured the same stable references.

**Trade-off:** This relies on React's stability guarantees for `dispatch` and
`setState`. If we ever needed to capture non-stable values (e.g. a callback
that depends on props), we'd need to use a ref indirection pattern. The current
design avoids this complexity entirely.

---

## 8. Command Isolation: Never Sending `/` to the Server

**Problem:** Chat commands (`/global_off`, `/global_on`) are purely client-side.
If a user types an unrecognized command like `/test`, it must not be sent to
the server as a `SendText` message — that would leak command syntax into the
chat room.

**Solution:** `handleCommand()` returns `{ consumed: true }` for **all** input
starting with `/`, regardless of whether the command is recognized. Unrecognized
commands get local feedback ("Unknown command: /test") but are never forwarded.

```typescript
if (!input.startsWith('/')) return { consumed: false };
// Everything below is consumed — never reaches the server.
const handler = COMMANDS[name];
if (!handler) return { consumed: true, feedback: `Unknown command: /${name}` };
return handler(args, ctx);
```

**Trade-off:** Users cannot send messages that start with `/` in chat. This is
a standard convention (Discord, Minecraft, etc.) and matches the spec, but it
means legitimate text like "/shrug" would be intercepted. The `@nickname` prefix
is reserved for Part 2 DM initiation, so that syntax is also unavailable for
regular messages.

---

## 9. Reconnection State Preservation

**Problem:** When the WebTransport connection drops and reconnects, the server
re-opens fresh streams and re-delivers full initial state (`ChatType`, `Nicks`,
`MsgLog`, etc.). The client needs to handle this gracefully: replace stale data
without losing the room's position in the UI (tab order, active room selection).

**Solution:** `ROOM_OPENED` preserves existing room metadata (`messages`,
`nicks`, `members`, `lastReadByUser`) while clearing ephemeral fields
(`serverMessages`, `systemEvents`, `typingUsers`). The preserved data serves
as a placeholder until the server's fresh `MsgLog` / `Members` replace it.
`RESET` marks all rooms disconnected but doesn't delete them, so tabs stay
visible during reconnection.

**Trade-off:** There's a brief window between `RESET` (all rooms disconnected)
and `ROOM_OPENED` (stream reopened) where the UI shows stale data from the
previous session. This is acceptable — the alternative (clearing all state on
RESET) would cause the entire chat to flash empty during reconnects, which is
worse UX.

---

## 10. GameLobby Ephemeral Lifecycle

**Problem:** GameLobby rooms are ephemeral — they exist only for the duration
of a game lobby. When the lobby ends, the server closes the stream. Unlike
other room types, the room should be completely removed from state (not kept
as disconnected), because it will never reconnect.

**Solution:** `ROOM_CLOSED` checks `room.chatType === 'GameLobby'` and deletes
the room from the Map entirely instead of setting `connected=false`. The
`ChatTabBar` also cleans up its `lastViewedAt` ref entries for deleted rooms
to prevent memory leaks from accumulating orphaned entries across many game
sessions.

**Trade-off:** If the `ChatType` message hasn't arrived yet when the stream
closes (unlikely but theoretically possible), `chatType` would be `null` and
the room would be kept as disconnected instead of deleted. This is a benign
failure mode — the room would be cleaned up on the next full reconnect when
the server doesn't reopen a stream for it.

---

## 11. Autocomplete vs Arrow Key Overloading

**Problem:** The `ChatInput` uses arrow keys for three different purposes:
1. Navigate command autocomplete suggestions (Up/Down when popup is open).
2. Switch chat tabs (Left/Right when input is empty and chat is open).
3. Scroll the message list (Up/Down when input is empty and chat is open).

These overlap — both autocomplete and message scrolling use Up/Down.

**Solution:** Priority-based key handling. Autocomplete takes precedence:

```
if autocomplete open && suggestions exist:
    Up/Down → navigate suggestions
    Enter   → select suggestion
    Escape  → close autocomplete
else:
    Up/Down (empty input + chat open) → scroll messages
    Left/Right (empty input + chat open) → navigate tabs
    Enter → send message
    Escape → collapse chat
```

The autocomplete only opens when the input starts with `/`, so there's no
ambiguity with normal message typing or empty-input arrow navigation.

**Trade-off:** Users can't scroll messages while the autocomplete popup is
visible. Since the autocomplete only appears during command input (a brief
interaction), this is not a practical limitation.

---

## 12. Client-Side Blocking as UX Boundary

**Problem:** The spec requires blocked users to be filtered client-side. The
server sends all messages regardless of block status. This means blocked users'
messages transit the network and are decoded — they're just hidden in the UI.

**Solution:** `preferences.blockedUsers` (a `number[]` in localStorage) is
checked during rendering. In the collapsed feed, blocked senders are filtered
out before adding to `feedItems`. In expanded mode, they're filtered when
computing `expandedItems`. The Username context menu provides Block/Unblock
that updates preferences immediately (persisted to localStorage).

**Trade-off:** This is a UX boundary, not a security boundary. A determined
user can read blocked messages by inspecting state or network traffic. The
server-side block list (Part 2: `POST /api/chat/block/{user_id}`) will
eventually prevent DM initiation and invitations from blocked users, but
in-room message filtering remains client-side per the spec.
