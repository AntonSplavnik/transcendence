# Game End Modal

## Overview

When a game ends, a modal is displayed on top of the still-visible 3D canvas (`/game` page) showing the final standings. The user must dismiss the modal via the "Back to Lobby" button, which navigates them to `/lobby`.

## Message flow

```
Backend: game loop exits (time limit, last player standing, disconnect)
  → Backend broadcasts LobbyServerMessage::GameEnded on lobby uni-stream
  → Frontend LobbyContext receives 'GameEnded', sets gameEndResult in state
  → Backend closes game bidi-stream
  → Frontend GameContext.onClose fires
    → Sees gameEndResult is pending → skips auto-navigation
  → GameBoard renders GameEndModal on top of the canvas
  → User clicks "Back to Lobby"
    → clearGameEndResult() + navigate('/lobby')
```

## Current state (placeholder data)

The backend currently sends `GameEnded` as a unit variant (no payload). The frontend initialises `gameEndResult` with `{ results: [] }`, and the modal renders placeholder rows (4 players, all stats at 0).

When the backend is updated to send real stats, only two places need changing:

1. `frontend/src/stream/types.ts` — move `'GameEnded'` from `LOBBY_UNIT_VARIANTS` to `LOBBY_OBJECT_VARIANTS` and update the union type
2. `frontend/src/contexts/LobbyContext.tsx` — parse `msg.GameEnded.results` instead of using an empty array

The modal component itself requires no changes.

## Future message shape

When the C++ game engine exposes end-of-game stats, the backend will send:

```json
{
  "GameEnded": {
    "results": [
      { "player_id": 3, "kills": 1, "damage_dealt": 620.0, "alive": true },
      { "player_id": 1, "kills": 1, "damage_dealt": 310.5, "alive": false },
      { "player_id": 2, "kills": 0, "damage_dealt": 95.0,  "alive": false }
    ]
  }
}
```

- Array sorted by final placement: index 0 = winner (1st place), last index = last place
- `alive: true` means the player survived to the end of the game
- `alive: false` means the player was eliminated during the game
- Tiebreaking among survivors is handled by the game engine

## Files involved

| File | Role |
|---|---|
| `frontend/src/contexts/LobbyContext.tsx` | Stores `gameEndResult` in lobby state; exposes `clearGameEndResult()` |
| `frontend/src/contexts/GameContext.tsx` | Suppresses auto-navigation when `gameEndResult` is pending |
| `frontend/src/components/GameBoard.tsx` | Renders `GameEndModal` over the canvas; handles dismiss → navigate |
| `frontend/src/components/modals/GameEndModal.tsx` | Modal component showing ranked player list |

## State shape

Added to `LobbyState` (active branch):

```ts
export interface PlayerGameResult {
  player_id: number;
  kills: number;
  damage_dealt: number;
  alive: boolean;
}

// In LobbyState:
gameEndResult: { results: PlayerGameResult[] } | null;
```

- `null` — no game-end result (normal state)
- `{ results: [] }` — game ended, backend didn't send stats (current)
- `{ results: [...] }` — game ended with stats from backend (future)

## Navigation guard

`GameBoard` normally redirects to `/home` when `gameState.status === 'idle'`. After a game ends, `gameState` transitions to idle (game stream closed) but the modal should remain visible. The guard is:

```ts
if (gameState.status === 'idle' && !hasGameEndResult) {
  // redirect away
}
// else: stay on /game, show modal over canvas
```

`GameContext.onClose` also checks for a pending result and skips its usual navigation when one is present.

## Accessibility

- Modal uses `role="dialog"` and `aria-modal="true"` (via the base `Modal` component)
- The standings list uses `role="list"` with `aria-label="Final standings"`
- Each row has an `aria-label` summarising rank, name, status, kills, and damage
- Visual-only elements (icons, badges, individual stat cells) are marked `aria-hidden="true"`
- The "Back to Lobby" button has `aria-label="Return to lobby"`
- Modal is not closable via ESC or click-outside (`closable={false}`) — dismiss is button-only

## Testing (temporary)

The 2-minute timer in `backend/src/game/game.rs` (lines 128–133) forces the game loop to exit after 120 seconds:

```rust
if update_snapshot.frame_number / 60 > 120 {
    info!("Game loop ending after 2 minutes");
    break;
}
```

Start a game with 2 players and wait ~2 minutes to trigger the modal.
