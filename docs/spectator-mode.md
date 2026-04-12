# Spectator Mode

Allows users to watch ongoing games in real time from a free-roaming
isometric camera, without participating as a player.

## Table of Contents

- [Requirements Coverage](#requirements-coverage)
- [How It Works](#how-it-works)
- [Backend](#backend)
- [Frontend](#frontend)
- [Files Changed](#files-changed)
- [Known Limitations](#known-limitations)

---

## Requirements Coverage

| Requirement | Status | Notes |
|---|---|---|
| Allow users to watch ongoing games | Done | Spectators receive a read-only game stream and see the full 3D arena |
| Real-time updates for spectators | Done | Same 60 Hz snapshot pipeline as players; no delay or degradation |
| Spectator chat (optional) | Not implemented | Spectators can still use the existing lobby chat; no dedicated spectator-only chat channel was added |

---

## How It Works

A spectator is a lobby member who is **not** in the player map.
They are routed to the game view (`/game`) and given a game stream of their
own.

### Joining before the game starts

Nothing changes. Spectators sit in the lobby and are redirected to `/game`
alongside players when `GameStarting` fires. The existing game-start flow
opens a game stream for every lobby member (including spectators).

### Joining mid-game

This is the new path. When a spectator joins a lobby that already has an
active game, the backend opens a game stream for them immediately and sends
a `PlayerJoined` message for each current player so the frontend can
bootstrap its player roster.

#### Backend sequence (manager.rs)

```
Phase 1  reserve slot           (no locks)
Phase 2  authenticate           (no locks)
Phase 3  finalize + snapshot    (lobby lock held)
           if game is active:
             collect player_data + clone game_streams Arc
Phase 4  open game stream       (no locks held)
           send PlayerJoined per player
           Arc::ptr_eq guard against game-ended race
```

The phased design avoids holding the lobby lock across the async
`create_stream` call. An `Arc::ptr_eq` check after re-acquiring the lock
detects the race where the game ends between Phase 3 and Phase 4 (the
`clear_game()` path replaces the Arc, so a pointer comparison is
sufficient). If the race is lost, the orphaned stream handle is explicitly
destroyed.

#### Frontend flow

1. `InGameGuard` (AppRoutes.tsx) redirects spectators to `/game` — the
   previous spectator exclusion was removed.
2. `GameBoard.tsx` determines `isSpectator` from the lobby player map and
   passes it to `GameCanvas`.
3. `GameCanvas.tsx` branches on `isSpectator`:
   - **Skips** local player model loading and spawn animation.
   - **Skips** input-to-server sending (spectators never call `onSendInput`).
   - **Adds** spectator camera controls (pan + zoom) instead of the
     player-follow camera.

---

## Backend

### New message: `GameServerMessage::PlayerJoined`

Added to `messages.rs`. Sent over the **game** stream (not lobby stream) to
bootstrap a mid-game spectator's knowledge of who is already playing.

```rust
PlayerJoined {
    player_id: u32,
    name: String,
    character_class: CharacterClass,
}
```

The frontend handles this in `GameContext.tsx` by populating
`characterClassesRef` and dispatching `PLAYER_JOINED` — the same effect as
receiving an initial `Spawn` event per player.

### Stream creation for spectators

Spectators get a full bidi stream via `create_stream::<GameClientMessage>`.
The filter callback accepts all messages (`|_, _| true`), but the C++ game
engine safely ignores input from unknown player IDs —
`World::setPlayerInput` looks up the player entity via
`getEntityByPlayerID` and returns early when the ID is not in the player
map (`entt::null` guard at `World.hpp:452`).

---

## Frontend

### Spectator camera (GameCanvas.tsx)

`setupSpectatorCamera` provides an orthographic free-camera that replaces
the default player-follow camera:

| Control | Action |
|---|---|
| WASD | Pan camera (isometric directions, same mapping as player movement) |
| Shift + WASD | Fast pan (2.4x speed) |
| Scroll wheel | Zoom in/out (ortho size 10 – 30, default 18) |

The camera reuses `setupInput` for key handling. Pan speed scales with the
current zoom level so the feel stays consistent when zoomed out.

Resize events are handled inside `setupSpectatorCamera` (recalculates the
orthographic projection from the current `ortho` value), keeping it
self-contained from the player resize handler.

### "Spectating" badge (GameBoard.tsx)

A `Badge` component renders in the top-right corner with an `Eye` icon when
the user is a spectator. Styled with `bg-stone-900/80 backdrop-blur-sm` to
stay visible without blocking the view.

### Routing changes (AppRoutes.tsx)

`InGameGuard` included spectators and players.
Both are sent to `/game` when a game is active. The idle fallback in `GameBoard`
simplified from conditional lobby/home redirect to just `/home`.

---

## Files Changed

| File | Change |
|---|---|
| `backend/src/game/manager.rs` | Mid-game spectator join: Phase 4 opens game stream, sends `PlayerJoined` per player, handles game-ended race |
| `backend/src/game/messages.rs` | Added `PlayerJoined` variant to `GameServerMessage` |
| `frontend/src/AppRoutes.tsx` | Removed spectator exclusion from `InGameGuard` |
| `frontend/src/components/GameBoard.tsx` | Added `isSpectator` prop pass-through, "Spectating" badge overlay |
| `frontend/src/components/GameBoard/GameCanvas.tsx` | Spectator camera setup, branched render loop (no input sending, no local player model) |
| `frontend/src/game/types.ts` | Added `PlayerJoined` to `GameServerMessage` union |
| `frontend/src/contexts/GameContext.tsx` | Handler for `PlayerJoined` game-stream message |

---

## Known Limitations

1. **Default character fallback** — if the `PlayerJoined` messages arrive
   after the first snapshot (unlikely but possible under load), remote
   players render as `DEFAULT_CHARACTER` until `characterClassesRef` is
   populated. This is cosmetic and self-corrects on the next `Spawn` event.

2. **No spectator chat** — the optional requirement was not implemented.
   Spectators can use the existing lobby chat stream but there is no
   dedicated spectator channel or in-game chat overlay.
   Most of the infrastructure for this is done, but we did not have
   time to implement it fully as a full featured chat.

3. **Render loop duplication** — the player and spectator render loops in
   `GameCanvas.tsx` share most of their body (frame timing, event
   processing, snapshot processing). A future cleanup could extract the
   shared tick logic into a helper.
