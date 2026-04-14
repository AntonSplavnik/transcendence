# Frontend Game Client

The game client renders a 3D isometric arena using Babylon.js inside a React app. It receives server-authoritative state over WebTransport and presents it visually. No simulation runs on the client — all positions, health, and combat outcomes come from the server.

---

## Stack

- **Babylon.js 8.x** — 3D engine (WebGL), orthographic camera, glTF models, skeletal animation
- **React 19** — UI overlay (lobby, HUD components, modals)
- **TypeScript** — strict types mirroring Rust message definitions
- **Babylon AudioEngineV2** — spatial 3D audio

---

## Scene Setup

A single persistent Babylon scene hosts the entire match. No scene switching or loading screens — all UI is React overlay.

```
GameCanvas.tsx (React component)
  └── Babylon Scene
        ├── Arena model (Forest.gltf)
        ├── Extended ground plane (1000×1000, dark green)
        ├── 4 boundary walls (50×50 play area, TERRAIN_EDGE=25)
        ├── Orthographic camera (isometric)
        └── Characters (AnimatedCharacter instances)
```

### Camera

- **Type:** Orthographic (true isometric, no perspective distortion)
- **Elevation angle:** 35.264° (standard isometric)
- **Offset:** `ISO_CAM_OFFSET = {x: 80, y: 56.57, z: -80}`
- **Ortho size:** 10 (controls zoom level)
- **Behavior:** follows local player position, recalculates ortho bounds on window resize

### Spectator Mode

When spectating, the camera is decoupled from any player:
- WASD pans the camera using the same isometric direction map
- Mouse wheel zooms (adjusts ortho size)
- No input sent to the server
- All player characters rendered as remote

---

## Character Management

### CharacterManager

Central entity manager. Tracks the local player and all remote players separately.

```
CharacterManager
├── localPlayer: AnimatedCharacter | null
├── remoteCharacters: Map<number, AnimatedCharacter>
├── characterStates: Map<number, CharacterState>
└── methods:
    ├── initLocalPlayer(config)
    ├── createRemoteCharacter(id, config)
    ├── removeCharacter(id)
    └── getCharacter(id)
```

### AnimatedCharacter

A single game entity: mesh, skeleton, animations, and weapon trail.

```
AnimatedCharacter
├── rootNode: TransformNode        position/rotation/scale
├── meshes: AbstractMesh[]         3D model
├── animations: Map<string, AnimationGroup>
├── skeleton: Bone hierarchy       for weapon attachment
├── trail: SwingTrail              weapon swing effect
└── currentAnimation
```

**Key methods:**
- `loadModel(url)` — load glTF mesh + skeleton
- `loadAnimations(url)` — load separate animation files
- `attachToBone(mesh, boneName)` — attach equipment (sword, shield)
- `playAnimation(name, loop, speed)` — stop current, start new
- `crossFadeTo(name, loop, speed, blend)` — smooth transition (~0.12s blend)

### Character Loading Flow

```
CharacterManager.initLocalPlayer(config)
  └── new AnimatedCharacter(scene)
        ├── loadModel(config.model)                   main glTF mesh
        ├── loadAnimations(config.animationSets[0])   idle/walk/run
        ├── loadAnimations(config.animationSets[1])   combat
        ├── loadAnimations(config.animationSets[2])   skills
        └── attachToBone(equipment, bone)             per slot
```

Remote characters follow the same flow, triggered by `SnapshotProcessor` when a new `player_id` appears.

### Character Configs

Each class defines a `CharacterConfig`:

```typescript
interface CharacterConfig {
    label: string;                     // "Knight"
    characterClass: string;            // server-side class name
    model: string;                     // glTF asset URL
    animationSets: string[];           // 3-4 animation files
    equipment: EquipmentSlot[];        // bone attachments
    scale: number;
    idleAnimation: AnimationEntry;
    walkAnimation: AnimationEntry;
    runAnimation: AnimationEntry;
    attackAnimations: AnimationEntry[]; // 3-stage combo
    skillAnimations: AnimationEntry[];  // 2 abilities
    trailColor: TrailColor;
    stats: CharacterStatValues;        // mirrors server stats
}
```

**Supported classes:** Knight, Rogue, Barbarian, Ranger, Mage, RogueHooded

**Key file:** `frontend/src/game/characterConfigs.ts`

---

## Input System

### Key Bindings

| Key | Action | Type |
|-----|--------|------|
| W/A/S/D | Movement | Continuous |
| Space | Jump | Continuous |
| Shift | Sprint | Continuous |
| E | Attack | One-shot |
| Q | Ability 1 | One-shot |
| F | Ability 2 | One-shot |

### Input State

```typescript
interface InputState {
    movementDirection: Vector3D;   // computed from WASD
    isAttacking: boolean;          // one-shot, cleared after send
    isJumping: boolean;
    isSprinting: boolean;
    isGrounded: boolean;           // from server
    isUsingAbility1: boolean;      // one-shot
    isUsingAbility2: boolean;      // one-shot
}
```

### Isometric Direction Mapping

WASD input is rotated 45° to match the isometric camera. A lookup table converts the 4-bit key mask to direction vectors:

```typescript
const bits = (W ? 8 : 0) | (A ? 4 : 0) | (S ? 2 : 0) | (D ? 1 : 0);
const [dx, dz] = ISO_DIRECTIONS[bits];
// W     → diagonal (-X, +Z)
// D     → diagonal (+X, +Z)
// W+D   → pure +Z
// S+A   → pure -Z
// opposite keys cancel out
```

### Processing

- **Continuous inputs** (movement, sprint, jump): sampled every frame from the `keysPressed` set
- **One-shot inputs** (attack, abilities): set on `KEY_DOWN`, cleared after sending to server
- Input sent to server every frame via `GameContext.sendInput()`

---

## Animation System

### Animation State Machine

Enum-based priority system. Higher-priority states block lower ones.

```
Priority (high → low):
  1. Spawn     — plays once on join, then → Idle
  2. Death     — terminal state, death anim → death pose
  3. Attack    — 3-stage combo chain, cancels on movement
  4. Skill     — plays full animation, then → Idle
  5. Idle      — default fallback
```

```typescript
enum AnimPhase { Idle, Spawn, Attack, Skill, Death }

class AnimationStateMachine {
    currentPhase: AnimPhase;
    tick(): void;    // detect phase transitions
}
```

### Jump State Machine

Separate from combat animation state:

```
GROUNDED → JUMP_START → AIRBORNE → LANDING → GROUNDED
```

### Dual-Track Animation

Two parallel pipelines drive character animation:

1. **Event-driven** (one-shot): `EventProcessor` receives `AttackStarted`, `SkillUsed`, `Spawn`, `Death` events and triggers the corresponding animation immediately
2. **Snapshot-driven** (steady-state): `SnapshotProcessor` reads `CharacterState` from the snapshot and applies fallback animations (walk, idle, sprint) when no event animation is active

Event animations always take priority. Snapshot animations fill in when no event is playing.

### Attack Combo Chain

Attacks have 3 stages (chain_stage 0, 1, 2). Each stage plays a different animation. `crossFadeTo()` blends between stages (~0.12s). The combo resets if the player moves or the window expires.

### Weapon Trail

`SwingTrail` renders a ribbon mesh behind the weapon during attacks:
- Updates per frame with weapon bone tip position + swing progress
- Shows the last 50% of the swing arc (`TAIL_FRACTION = 0.5`)
- Vertex colors gradient from base (tail) to tip color
- Rebuilt every frame (ribbon mesh recreation)

**Key file:** `frontend/src/game/SwingTrail.ts`

---

## Snapshot Processing

### Server → Client State Flow

```
Server broadcasts GameStateSnapshot at 60 Hz
  │
  ▼
GameContext stores in snapshotRef (React ref, NOT state — avoids 60 Hz re-renders)
  │
  ▼
Babylon render loop reads snapshotRef.current each frame
  │
  ├── SnapshotProcessor.processSnapshot()
  │     ├── new player_id? → create remote character
  │     ├── update position (rootNode.position)
  │     ├── update yaw (rootNode.rotation.y)
  │     ├── update HUD (health, stamina, cooldowns)
  │     └── set fallback animation from state field
  │
  └── EventProcessor.processEvents()
        ├── drain eventsRef queue
        ├── AttackStarted → play attack anim (chain_stage)
        ├── SkillUsed → play skill anim (skill_slot)
        ├── Spawn → play spawn anim
        ├── Death → play death anim
        └── MatchEnd → show results UI
```

### Position Strategy

Abstracted behind an interface to allow future interpolation:

```typescript
interface PositionStrategy {
    pushServerState(playerId, position, velocity, yaw, timestamp): void;
    getVisualState(playerId, renderTime): { position, yaw };
    remove(playerId): void;
}
```

**Current implementation: `DirectPositionStrategy`** — no interpolation, returns latest server position directly. Ready for swap to interpolation/extrapolation.

### Character State Enum

Mirrors the server-side enum:

```typescript
CharacterState = {
    Idle: 0,
    Walking: 1,
    Sprinting: 2,
    Attacking: 3,
    Casting: 4,
    Stunned: 5,
    Dead: 6,
}
```

---

## HUD

`GameHUD` renders UI elements using Babylon's `AdvancedDynamicTexture` overlay:

### Local Player (bottom center)
- Health bar (red)
- Stamina bar (green)
- Attack cooldown progress
- Ability 1 cooldown progress
- Ability 2 cooldown progress

### Remote Players (world-space)
- Health bar above each character (projected from 3D to screen space)
- Updated per frame in `onBeforeRenderObservable`

**Key file:** `frontend/src/game/HUD.ts`

---

## Audio System

Decoupled from game logic. `AudioEventSystem` maps game events to sounds using trigger tables.

### Four Trigger Pipelines

| Pipeline | Source | Example |
|----------|--------|---------|
| `LOCAL_INPUT_TRIGGERS` | Edge-detect on local key presses | footstep on walk start |
| `LOCAL_CONTINUOUS_TRIGGERS` | Repeating while input held | footstep loop while moving |
| `REMOTE_SNAPSHOT_TRIGGERS` | Remote player state changes | remote footsteps |
| `GAME_EVENT_TRIGGERS` | Server events | hit impact, death cry |

### Class-Specific Sounds

Sound IDs resolve per character class (e.g., `"knight_footstep"` vs `"player_footstep"` fallback).

**Key files:** `frontend/src/audio/AudioEventSystem.ts`, `frontend/src/audio/triggerTables.ts`

---

## Render Loop

```
onBeforeRenderObservable (every frame, capped at 60 FPS):
  1. processEvents(eventsRef.current)     drain server events → animations
  2. processSnapshot(snapshotRef.current)  positions, health, fallback anims
  3. updateLocalAnimation(input, state)    local player anim SM
  4. sendInput(inputState)                 send to server via bidi stream
  5. trail.update()                        weapon swing ribbon
  6. hud.update()                          health bars, cooldowns
  7. camera.position = localPlayer.pos + offset
  8. scene.render()
```

Frame rate capped manually via `performance.now()` delta check.

---

## React Integration

```
GameBoard.tsx (page component)
  └── GameCanvas.tsx (Babylon canvas)
        ├── creates Babylon Engine + Scene
        ├── loads arena, characters
        └── connects to GameContext for stream data

GameContext.tsx (React context)
  ├── registers Game stream handler with ConnectionManager
  ├── stores snapshotRef + eventsRef (refs, not state)
  ├── provides sendInput() callback
  └── provides game lifecycle state (active, spectating, etc.)
```

Game state is stored in **refs** (`useRef`), not React state, to avoid triggering 60 re-renders per second. Only UI-relevant changes (match end, player join/leave) use React state.

---

## Directory Structure

```
frontend/src/game/
├── GameClient.ts              Top-level game coordinator
├── CharacterManager.ts        Entity manager (local + remote)
├── AnimatedCharacter.ts       Entity (model, skeleton, animations, trail)
├── SnapshotProcessor.ts       Server snapshot → visual state
├── EventProcessor.ts          Server events → one-shot animations
├── AnimationStateMachine.ts   Phase state machine + jump state
├── HUD.ts                     Health, stamina, cooldown bars
├── SwingTrail.ts              Weapon swing ribbon effect
├── characterConfigs.ts        6 character definitions
├── constants.ts               Camera, input, animation constants
└── types.ts                   TS types mirroring Rust messages

frontend/src/components/
├── GameBoard.tsx              Page-level component
└── GameBoard/GameCanvas.tsx   React wrapper for Babylon scene

frontend/src/contexts/
├── GameContext.tsx             Game stream handler + refs
└── LobbyContext.tsx            Lobby stream handler

frontend/src/audio/
├── AudioEngine.ts             Babylon audio bus setup
├── AudioEventSystem.ts        Event → sound mapping
├── SoundBank.ts               Sound asset registry
└── triggerTables.ts            Trigger definitions
```
