# Chat System — Frontend Implementation

Documentation for the chat overlay implemented in Part 1. Covers architecture,
file layout, state management, UI behaviour, and extension points for Part 2.

---

## Architecture Overview

The chat system is a **fixed bottom-left overlay** that communicates with the
backend via WebTransport bidi streams. The server is authoritative — it opens
one bidi stream per chat room, and the client handles incoming `ServerMessage`
variants uniformly without branching on room type.

```
App.tsx
└── ChatProvider (contexts/ChatContext.tsx)
    └── AppRoutes.tsx
        └── RealtimeStatusOverlays
            └── ChatErrorBoundary (ui/ErrorBoundary.tsx)
                └── ChatOverlay (chat/ChatOverlay.tsx)
                    ├── ChatTabBar
                    ├── ChatMessageList
                    │   └── ChatMessage → Username
                    ├── ChatErrorToast
                    └── ChatInput (+ autocomplete popup)
```

### Provider nesting order

```
AuthProvider → StreamProvider → NotificationProvider → ChatProvider → AppRoutes
```

`ChatProvider` must sit inside `StreamProvider` (needs `connectionManager`) and
`AuthProvider` (needs `user.id` for preferences).

---

## File Manifest

| File | Purpose |
|------|---------|
| `src/stream/types.ts` | `StreamType` union — added `{ ChatRoom: string }` |
| `src/chat/types.ts` | All wire protocol types + internal state types |
| `src/chat/storage.ts` | localStorage persistence for per-user preferences |
| `src/chat/commands.ts` | Client-side `/` command registry + parser |
| `src/chat/chatReducer.ts` | Pure reducer over `Map<roomId, ChatRoomState>` |
| `src/contexts/ChatContext.tsx` | Provider, bidi handler factory, send helpers |
| `src/components/ui/ErrorBoundary.tsx` | Generic silent error boundary (reusable) |
| `src/components/ui/Username.tsx` | Colored user handle with context menu |
| `src/components/chat/ChatOverlay.tsx` | Root container — T-key toggle, layout |
| `src/components/chat/ChatTabBar.tsx` | Room tabs with overflow chevrons |
| `src/components/chat/ChatMessageList.tsx` | Collapsed feed + expanded scrollable list |
| `src/components/chat/ChatMessage.tsx` | Single DisplayItem renderer |
| `src/components/chat/ChatInput.tsx` | Input with autocomplete + key handlers |
| `src/components/chat/ChatErrorToast.tsx` | Inline error display above input |
| `src/components/chat/index.ts` | Barrel export |

---

## State Management

### Reducer (`chatReducer.ts`)

State shape: `Map<string, ChatRoomState>`.

Every action returns a new `Map` reference so React detects the change.
Inner `Set` and `Map` types (e.g. `typingUsers`, `nicks`) are also cloned
on mutation.

| Action | Effect |
|--------|--------|
| `ROOM_OPENED` | Create or reuse room, set `connected=true`, store `send`. Clears ephemeral fields (serverMessages, systemEvents). |
| `ROOM_CLOSED` | GameLobby → delete room entirely. Others → `connected=false, send=null`. |
| `RESET` | Mark all rooms disconnected (connection dropped). |
| `MSG_LOG` | **Replace** message list (initial state delivery). |
| `NEW_MSG` | Append message + clear typing for sender. |
| `IS_TYPING` / `CLEAR_TYPING` | Add/remove userId from `typingUsers` Set. |
| `NICKS` / `NICK` | Populate or upsert nickname map. |
| `MEMBERS` | Replace member list + online set. |
| `MEMBER_ADDED` / `MEMBER_REMOVED` | Update members + append SystemEvent. |
| `MEMBER_CONNECTED` / `MEMBER_DISCONNECTED` | Update online set. |
| `READ_TEXT` | Update lastReadByUser map. |
| `CHAT_TYPE` / `CHAT_NAME` | Update room metadata. |
| `NEW_SERVER_MSG` | Append ephemeral server message (KillFeed etc.). |

### Context (`ChatContext.tsx`)

The provider registers a `BidiHandlerFactory` for `"ChatRoom"` with the
`ConnectionManager`. Each incoming stream gets a handler that dispatches
actions to the shared reducer.

**Exposed state:**

```typescript
interface ChatContextType {
  rooms: Map<string, ChatRoomState>;
  orderedRoomIds: string[];        // Global → Lobby → others by last activity
  activeRoomId: string | null;
  setActiveRoomId: (id: string | null) => void;
  sendMessage: (roomId: string, text: string) => void;
  sendTypingIndicator: (roomId: string) => void;
  sendReadReceipt: (roomId: string, messageId: string) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  preferences: ChatPreferences;
  updatePreferences: (patch: Partial<ChatPreferences>) => void;
  chatError: { roomId: string; error: ChatStreamError } | null;
}
```

**Timeout management** (all in refs, cleaned up on unmount):

| Ref | Purpose | Cleanup |
|-----|---------|---------|
| `typingTimeoutsRef` | Display timeout per `${roomId}:${userId}` | New IsTyping, NewMsg, room close, RESET, unmount |
| `typingSendCooldownsRef` | 3s cooldown per room on outgoing IsTyping | Self-clearing timeout, unmount |
| `errorClearRef` | 4s auto-dismiss for chatError | New error, unmount |
| `sendDisabledRef` | 200ms per-room anti-double-send | Self-clearing timeout, unmount |
| `roomsRef` | Latest rooms for stable callbacks | Synced via useEffect |

**Send guards:** All three send helpers (`sendMessage`, `sendTypingIndicator`,
`sendReadReceipt`) check both `room.send` and `room.connected` before calling.
This prevents errors during the brief window between RESET and ROOM_CLOSED.

---

## Wire Protocol

### StreamType header

```
{ ChatRoom: "<ulid>" }   // room's ULID identifier
```

### ServerMessage → action mapping

| ServerMessage variant | Reducer action |
|-----------------------|----------------|
| `ChatType(type)` | `CHAT_TYPE` |
| `ChatName(name)` | `CHAT_NAME` |
| `Nicks(batch)` | `NICKS` |
| `Nick { user_id, nickname }` | `NICK` |
| `MsgLog(messages)` | `MSG_LOG` |
| `NewMsg(msg)` | `CLEAR_TYPING` + `NEW_MSG` |
| `NewServerMsg(msg)` | `NEW_SERVER_MSG` |
| `IsTyping(user_id)` | `IS_TYPING` (+ timeout → `CLEAR_TYPING`) |
| `ReadText { user_id, message_id }` | `READ_TEXT` |
| `Members { members, online }` | `MEMBERS` |
| `MemberConnected(user_id)` | `MEMBER_CONNECTED` |
| `MemberDisconnected(user_id)` | `MEMBER_DISCONNECTED` |
| `MemberAdded(member)` | `MEMBER_ADDED` |
| `MemberRemoved { user_id, actor_id }` | `MEMBER_REMOVED` |
| `Error(err)` | Sets `chatError` state (4s auto-clear) |

### ClientMessage

| Variant | When sent |
|---------|-----------|
| `{ SendText: string }` | User presses Enter (after command check) |
| `'IsTyping'` | User types non-command text (3s send cooldown) |
| `{ ReadText: string }` | Read pointer advances (Part 2 DM) |

---

## UI Behaviour

### Modes

| Mode | Trigger | Appearance |
|------|---------|------------|
| **Collapsed** | Default / Escape | Fading feed of recent messages, input with `_` placeholder |
| **Expanded** | Click input / press `T` | Tab bar, scrollable room messages, typing indicator |

### Key bindings (all stopPropagation to prevent Babylon.js capture)

| Key | Context | Action |
|-----|---------|--------|
| `T` | Document (not in input/textarea) | Open chat + focus input |
| `Enter` | Input | Send message or execute command |
| `Escape` | Input (autocomplete open) | Close autocomplete |
| `Escape` | Input (autocomplete closed) | Collapse chat + blur |
| `←` / `→` | Input empty + chat open | Navigate tabs |
| `↑` / `↓` | Input empty + chat open | Scroll message list ±48px |
| `↑` / `↓` | Autocomplete open | Navigate suggestions |

### Collapsed feed

- Merges messages from all rooms (filtered: blocked users silent, global if disabled).
- Shows last 7 items with room tags: `[G]`, `[L]`, `[@Alice]`.
- Each item fades over 8s via `animate-chat-fade` (holds 5s, fades 3s).
- `onAnimationEnd` removes item from feed state.
- `pointer-events-none` — no interactivity on collapsed messages.

### Expanded view

- Active room only, `max-h-[50vh]`, no visible scrollbar (`scrollbar-none`).
- Top fade gradient when scrolled up.
- Auto-scrolls to bottom on new messages if near bottom (within 8px).
- Typing indicator: "Alice is typing..." / "Several people are typing..."

### Page-aware backgrounds

| Page | Collapsed | Expanded |
|------|-----------|----------|
| Game (`/game`) | Transparent | `bg-stone-950/60` glass |
| Other | `bg-stone-900` | `bg-stone-900` |

The input always has `bg-stone-950/60 border border-stone-700/40` — it needs
a guaranteed readable surface regardless of what renders behind it.

---

## Chat Commands (Part 1)

All input starting with `/` is consumed client-side — nothing reaches the server.

| Command | Effect |
|---------|--------|
| `/global_off` | Hide global chat from collapsed feed + expanded view |
| `/global_on` | Restore global chat visibility |
| Unknown `/...` | Shows "Unknown command" feedback locally |

Autocomplete popup appears when typing `/`, filtered as you type. Arrow keys
navigate, Enter selects, Escape closes.

---

## Preferences

Stored in localStorage at `chat.preferences.${userId}` (per-user).

```typescript
interface ChatPreferences {
  globalEnabled: boolean;   // /global_off, /global_on
  visible: boolean;         // External toggle (friend list integration)
  blockedUsers: number[];   // Client-side message filter
}
```

Defaults: `{ globalEnabled: true, visible: true, blockedUsers: [] }`.

`loadPreferences()` wraps `JSON.parse` in try/catch with safe fallback.
`savePreferences()` silently ignores quota errors.

---

## Username Component (`ui/Username.tsx`)

Reusable across chat and future features (friend list, game UI).

- **Self**: static "You" in `text-stone-400`, no interactivity.
- **Others**: deterministic color from `userId % 6`:
  `gold-300`, `info-light`, `accent-coral`, `warning-light`, `success-light`, `accent-teal`.
- **`interactive={false}`**: plain colored span (collapsed mode).
- **`interactive={true}`**: hover underline, click opens context menu.

Context menu items:
- Show Profile (disabled stub)
- Message (disabled — Part 2)
- Copy Username (active)
- Friend Request (disabled stub)
- Invite to Game (disabled stub)
- Block / Unblock (active — updates preferences immediately)

---

## Security

| Concern | Mitigation |
|---------|------------|
| XSS | All content rendered as React text children — auto-escaped |
| Oversized messages | Client-side render cap at 4096 chars + `break-all` overflow |
| Command injection | `handleCommand` consumes ALL `/...` input |
| localStorage tampering | `loadPreferences` try/catch with safe defaults |
| Rate limiting | 200ms client send cooldown + server >8 msgs/5s |
| Disconnected sends | All send helpers guard `room.connected` before calling `send` |
| Blocked users | Client-side filter only (UX boundary, not security) |

---

## Part 2 Extension Points

| Feature | Where to add |
|---------|-------------|
| REST API calls | New `src/api/chat.ts` module |
| DM initiation | Username context menu "Message" button |
| `/leave`, `/block`, `/unblock` | `chat/commands.ts` COMMANDS registry |
| Room creation UI | New component using `POST /api/chat/rooms` |
| Notification handlers | `NotificationContext` — `DmRequest`, `ChatInvitation` |
| Room renaming | `PATCH /api/chat/rooms/{id}` from tab context menu |
| Blocked user list fetch | `GET /api/chat/blocked` on connect |

The reducer and ServerMessage handler already handle all 15 variants — Part 2
primarily adds REST calls and UI surfaces for features that are already wired
in the stream protocol.

---

## Performance

| Optimization | Location |
|--------------|----------|
| Stable send callbacks via `roomsRef` | `ChatContext.tsx` — `useCallback(fn, [])` |
| Memoized `expandedItems` sort | `ChatMessageList.tsx` — `useMemo` on activeRoom/blockedUsers |
| Memoized `orderedRoomIds` sort | `ChatContext.tsx` — `useMemo` on rooms |
| Stable `onClose` for context menu | `Username.tsx` — `useCallback(() => setMenuOpen(false), [])` |
| Collapsed feed capped at 7 items | `ChatMessageList.tsx` — `slice(-7)` |
| `seenIdsRef` pre-populated on mount | `ChatMessageList.tsx` — prevents history flood |
| Extracted `getDisplayKey`/`getDisplayTimestamp` | `ChatMessageList.tsx` — eliminates repeated ternaries |
