# Audio System

End-to-end documentation of the audio system used in the Transcendence frontend: how sounds are loaded, routed, triggered, and persisted, plus a per-file walkthrough of every module under `frontend/src/audio/`.

## Table of Contents

1. [Goals](#1-goals)
2. [Architecture overview](#2-architecture-overview)
3. [Files in `frontend/src/audio/`](#3-files-in-frontendsrcaudio)
4. [Module-by-module walkthrough](#4-module-by-module-walkthrough)
5. [End-to-end flows](#5-end-to-end-flows)
6. [Extending the system](#6-extending-the-system)
7. [Persistence and defaults](#7-persistence-and-defaults)
8. [Why this shape?](#8-why-this-shape)
9. [Reference: the AudioHandle and GameAudioHandle interfaces](#9-reference-the-audiohandle-and-gameaudiohandle-interfaces)
10. [Sound assets inventory](#10-sound-assets-inventory)

---

## 1. Goals

The audio system has to serve very different needs at the same time:

- **Menu / UI audio** — background music that follows the route (landing, dashboard…), one-shot click sounds for every interactive element, notification chimes from realtime stream events.
- **Gameplay audio** — 3D-positional SFX for footsteps, jumps, lands, attacks, hits, deaths, spawns; ambient loops tied to the current scene; shuffled in-game music playlist.
- **User control** — a settings modal exposes Music / UI / In-Game volume sliders and a global mute, with persistence across reloads. The In-Game slider controls SFX, ambient, **and** music when in-game.
- **One source of truth** — a single Babylon `AudioEngineV2` and a single shared `SoundBank`, so the volume sliders and mute toggle reach every sound, and so we never load the same buffer twice.

The system is built on Babylon's `AudioV2` API (Web Audio under the hood) and exposed to React through a single context provider.

### Why an Audio System (and not ad-hoc sound calls)?

In a multiplayer game, audio is not just a UI detail. It is part of game readability and player feedback, with hard constraints:

- **Synchronization**: sound must line up with what players see locally and remotely.
- **Spatialization**: position and distance must be audible (an enemy 2m away should not sound like one 50m away).
- **Low perceived latency**: local actions must feel immediate, even when the server stays authoritative.
- **Variation**: repeating the same sample hundreds of times causes fatigue; randomized pitch/volume/variation are required.
- **Performance**: many concurrent sounds without glitching, clipping, or runaway CPU usage.
- **Extensibility**: adding a new gameplay sound should be mostly data work, not control-flow surgery.

This is why the project uses a dedicated audio architecture (engine + buses + bank + trigger tables) instead of scattered `playSound("x")` calls.

### Industry References and Design Principles

The design follows patterns popularized by middleware such as **Wwise** and **FMOD**, adapted to our Babylon/React stack:

- **Event-driven audio**: gameplay emits semantic events, not file paths.
- **Sound banks**: assets are loaded and reused from a central registry.
- **Mixer buses**: category routing (`master > sfx/music/ambient/ui`) for consistent mixing and user controls.
- **Decoupled responsibilities**: gameplay decides *what happened*; audio decides *how to render it*.
- **Parametric randomization**: per-play variation for realism and fatigue reduction.
- **Concurrency control**: `maxInstances`, cooldowns, and priorities to avoid audio spam.

Guiding rule:

```
Gameplay never says "play jump_03.wav at volume 0.7".
Gameplay says "a jump happened at position (x, y, z)".
The audio system decides how to play it.
```

This separation keeps gameplay code clean and lets us iterate on assets/mix/routing without touching core game logic.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              <AudioProvider>                             │
│                         (mounted once at app root)                       │
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────┐     │
│   │             GameAudioEngine  (SINGLETON, shared)               │     │
│   │                                                                │     │
│   │   master ─┬─> music bus ──► currentMusic slot (1 active)       │     │
│   │           ├─> ambient bus ─► currentAmbient slot (1 active)    │     │
│   │           ├─> sfx bus ─────► gameplay footsteps/jumps/combat   │     │
│   │           └─> ui bus ──────► clicks, notifications, lobby      │     │
│   │                                                                │     │
│   │   listener  ──► attached to local player root node             │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────┐     │
│   │             SoundBank  (SINGLETON, shared buffers)             │     │
│   │   loads every sound once at startup — reused by UI + game      │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────┐     │
│   │             Shuffle playlist (in-game music)                   │     │
│   │   plays random tracks from music_ingame variations             │     │
│   │   chains via onEndedObservable — never repeats same track      │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│   state: { isReady, engine, bank }  ──► context value                    │
└──────────────┬───────────────────────────────────┬───────────────────────┘
               │                                   │
               │                                   │
       ┌───────▼────────┐                 ┌────────▼──────────┐
       │  useUIAudio()  │                 │  useGameAudio()   │
       │                │                 │                   │
       │  playSound     │                 │  engine           │
       │  playMusic     │                 │  soundBank        │
       │  stopMusic     │                 │  attachListener   │
       │  playAmbient   │                 │  playSceneMusic   │
       │  stopAmbient   │                 │  stopSceneMusic   │
       │  setBusVolume  │                 │  playSceneAmbient │
       │  setMuted      │                 │  stopSceneAmbient │
       │                │                 │  playMusicPlaylist│
       │                │                 │  stopMusicPlaylist│
       └───────┬────────┘                 └────────┬──────────┘
               │                                   │
   ┌───────────┼───────────┐                       │
   │           │           │                       │
┌──▼────┐ ┌────▼─────┐ ┌───▼──────┐        ┌───────▼────────────┐
│Audio  │ │ Music    │ │Notif     │        │ GameCanvas         │
│Setting│ │Controller│ │Toast     │        │ (React component)  │
│Modal  │ │(route→   │ │(stream   │        │                    │
│       │ │ music/   │ │ events)  │        │  - isReady gate    │
│sliders│ │ ambient) │ │          │        │  - playSceneAmbient│
│+ mute │ │          │ │          │        │    ('amb_forest')  │
└───────┘ └──────────┘ └──────────┘        │  - playMusicPlay  │
                                           │    list()          │
                                           │  - passes engine + │
                                           │    bank to ctor    │
                                           └─────────┬──────────┘
                                                     │ constructs
                                                     ▼
                                           ┌────────────────────┐
                                           │ GameClient (class) │
                                           │                    │
                                           │  engine.attach     │
                                           │   Listener(root)   │
                                           │                    │
                                           │  AudioEventSystem  │
                                           │  ├─ onLocalInput   │
                                           │  ├─ onRemote       │
                                           │  │   Snapshot      │
                                           │  └─ onGameEvents   │
                                           │      │             │
                                           │      ▼             │
                                           │  soundBank.get     │
                                           │  RandomSound(...)  │
                                           │      │             │
                                           │      └─► sfx bus   │
                                           └────────────────────┘
```

**Key invariants:**

1. **One engine, one bank.** The `GameAudioEngine` and `SoundBank` are created once by `AudioProvider` and reused by every consumer — UI, modal, game scene. There is no "second audio system" running in parallel.
2. **Two hooks, one context.** `useUIAudio()` exposes the high-level UI API (play music, set bus volumes, mute). `useGameAudio()` exposes the lower-level game API (raw engine, sound bank, listener attachment, scene-scoped music/ambient, playlist). Both read the same context — they are different views of the same state.
3. **Bus structure is fixed.** Four output buses — `sfx`, `music`, `ambient`, `ui` — all routed through a `master` bus. The settings sliders map directly to these buses (Music → music, UI → ui, Game → sfx + ambient + music together).
4. **All routing happens through the buses.** Individual sounds never set `volume` directly for muting; the master bus is the only gate. Setting `master.volume = 0` silences the entire app.
5. **Music bus is context-aware.** In menus the music bus volume is driven by the "Music Volume" slider. When the in-game playlist starts, the bus switches to the "Game Volume" slider. When the game ends, it reverts to the menu slider value.

---

## 3. Files in `frontend/src/audio/`

| File | Lines | Role |
|---|---|---|
| `AudioEngine.ts` | ~85 | Babylon `AudioEngineV2` wrapper. Creates the master + sfx/music/ambient/ui buses, exposes `getBus(name)`, `attachListener(node)`, `setMasterVolume(v)`, `dispose()`. The only file that talks to Babylon's audio API directly. |
| `SoundBank.ts` | ~176 | Loads every entry from `SOUND_DEFINITIONS` once at startup. Builds an `id → StaticSound[]` map for variation rolls. Falls back to procedural synth when a file fails to load. |
| `soundDefinitions.ts` | ~470 | Pure data table: every sound the app knows about — id, file paths, volume/pitch ranges, bus assignment, spatial settings, cooldown. The single source of truth for "what sounds exist". |
| `AudioProvider.tsx` | ~300 | React context provider. Owns the engine + bank lifecycle, applies persisted user settings on init, exposes `useUIAudio()` and `useGameAudio()` hooks, manages the global click sound listener, and the in-game music shuffle playlist. |
| `audioSettings.ts` | ~63 | `localStorage` persistence for `{ musicVolume, uiVolume, inGameVolume, muted }`. Validates + clamps values on read so corrupted storage never breaks the engine. |
| `AudioEventSystem.ts` | ~190 | Game-side event router. Three pipelines (local input, remote snapshot delta, server game events) consume the trigger tables and play the right sound at the right position. Lives inside `GameClient`. |
| `triggerTables.ts` | ~180 | Pure data tables that drive `AudioEventSystem`. Add a new gameplay sound = add a row, no code changes. Type-safe authoring helper for `GameEvent` triggers. |
| `MusicController.tsx` | ~47 | Tiny React component that maps the current route to a `music_*`/`amb_*` id and calls `useUIAudio().playMusic/playAmbient`. Mounted once inside `<AudioProvider>`. |

Plus consumer files outside the audio folder:

- `frontend/src/components/modals/AudioSettingsModal.tsx` — the settings dialog with the three sliders + mute checkbox.
- `frontend/src/components/GameBoard/GameCanvas.tsx` — the React component that mounts the Babylon scene; it consumes `useGameAudio()` and feeds the engine + bank into the `GameClient` class that runs the game loop.

---

## 4. Module-by-module walkthrough

### 4.1 `AudioEngine.ts`

```ts
class GameAudioEngine {
  initialize(): Promise<void>          // create the AudioEngineV2 + 5 buses
  getEngine(): AudioEngineV2
  getBus(name): AudioBus               // 'sfx' | 'music' | 'ambient' | 'ui' (defaults to sfx)
  attachListener(node): void           // for 3D spatial audio
  setMasterVolume(volume): void        // 0 silences everything
  isInitialized(): boolean
  dispose(): void
}
```

`initialize()` builds the bus topology:

```
master (MainAudioBus)
 ├─ sfx     (default volume 1.2)
 ├─ music   (default volume 0.5)
 ├─ ambient (default volume 1.0)
 └─ ui      (default volume 0.7)
```

These default volumes are immediately overridden by `loadAudioSettings()` once `AudioProvider` finishes init so the first frame the user hears uses their persisted preferences, not the hard-coded values.

The `listenerEnabled: true` flag passed to `CreateAudioEngineAsync` is what unlocks 3D positional audio. Without it, every spatial sound would play at center-pan with no distance attenuation.

### 4.2 `SoundBank.ts` + `soundDefinitions.ts`

`SOUND_DEFINITIONS` is a flat array of `SoundDefinition` objects. Each entry looks like:

```ts
{
  id: 'knight_footstep',
  variations: [
    '/sounds/sfx/mouvement/knight/knight_footstep_01.wav',
    '/sounds/sfx/mouvement/knight/knight_footstep_02.wav',
    // …
  ],
  volume: { min: 0.8, max: 1.2 },
  pitch:  { min: 0.9, max: 1.1 },
  bus: 'sfx',
  spatial: true,
  maxDistance: 30,
  minDistance: 3,
  cooldown: 50,
  priority: 2,
  maxInstances: 5,
}
```

The system currently knows about ~38 sound IDs grouped by category:

| Category | IDs |
|---|---|
| Movement (generic fallback) | `player_jump` (4 vars), `player_land` (1), `player_footstep` (5) |
| Movement — Knight class | `knight_footstep` (3), `knight_jump` (3), `knight_land` (2) |
| Movement — Rogue class | `rogue_footstep` (3), `rogue_jump` (3), `rogue_land` (2) |
| Combat (generic fallback) | `player_attack_swing` (5), `player_ability1` (2), `player_ability2` (2) |
| Combat — Knight class | `knight_attack_swing` (4), `knight_ability1` (2), `knight_ability2` (1) |
| Combat — Rogue class | `rogue_attack_swing` (4) |
| Impacts | `player_hit` (1), `player_death` (1) |
| Spawning | `player_spawn` (1) |
| UI | `ui_click` (1), `ui_notif` (1), `ui_ticking` (1), `ui_lobby_join` (1), `ui_lobby_leave` (1) |
| Music — In-Game | `music_ingame` (5 variations, shuffled playlist) |
| Music — Menu | `music_main_theme` (1), `music_dashboard` (1) |
| Ambient | `amb_montagne` (1), `amb_forest` (1) |

`SoundBank.loadAll(engine)`:

1. Iterates `SOUND_DEFINITIONS`.
2. For each variation, calls `createSoundAsync(url, { outBus: <bus from def>, spatialEnabled, spatialMaxDistance, … })`.
3. On success, pushes the loaded `StaticSound` into the variation list and records the id in `loadedFromFile`.
4. On failure, calls `createProceduralFallback(def, engine, audioEngine)` this synthesises a tone with the right envelope for the category (jump = upward sweep, land = downward thump, etc.) so the gameplay still has audio feedback even if a file is missing or 404s.
5. Returns when every definition is processed.

`getRandomSound(id)` rolls one variation uniformly. Callers (the AudioProvider and AudioEventSystem) then apply per-shot randomization on `volume` + `playbackRate` from `def.volume` and `def.pitch` ranges, so two consecutive footsteps never sound identical.

`hasLoadedFiles(id)` is used by `AudioEventSystem` for the **class-aware fallback** — see §4.6.

### 4.3 `audioSettings.ts`

Tiny module, big role: it's the ground truth for what the user wants their volumes to be.

```ts
interface AudioSettings {
  musicVolume: number;   // 0..1
  uiVolume: number;      // 0..1
  inGameVolume: number;  // 0..1, drives sfx + ambient + music in-game
  muted: boolean;
}

const DEFAULT_AUDIO_SETTINGS = {
  musicVolume: 0.5,
  uiVolume: 0.7,
  inGameVolume: 1.0,
  muted: false,
};
```

`loadAudioSettings()` reads `localStorage['transcendence.audio_settings']`, defensively parses it, clamps every numeric field to `[0, 1]`, falls back to defaults for missing or invalid fields, and never throws corrupted storage just yields defaults.

`saveAudioSettings(settings)` swallows storage errors silently (private mode, quota exceeded), so the in-memory state stays correct even when persistence is unavailable.

### 4.4 `AudioProvider.tsx`

Owns the entire audio lifecycle. Mounted once at the app root, **above** `MusicController` and `<AppRoutes>`.

**State:**

```ts
const engineRef           = useRef<GameAudioEngine | null>(null);
const bankRef             = useRef<SoundBank | null>(null);
const currentMusicRef     = useRef<StaticSound | null>(null);
const currentMusicIdRef   = useRef<string | null>(null);
const currentAmbientRef   = useRef<StaticSound | null>(null);
const currentAmbientIdRef = useRef<string | null>(null);

// Playlist state
const playlistActiveRef   = useRef(false);
const playlistObserverRef = useRef<Observer<StaticSound> | null>(null);

const [isReady, setIsReady] = useState(false);
const [engine, setEngine]   = useState<GameAudioEngine | null>(null);
const [bank,   setBank]     = useState<SoundBank | null>(null);
```

The refs are for imperative reads inside the `play*Impl` helpers (no closure staleness, no re-render churn). The `useState` mirrors are for the **context value** — consumers like `useGameAudio()` need a reactive engine/bank that triggers re-renders when init finishes (and reading refs during render is unsafe in React).

**Init flow** (inside `useEffect(() => { … }, [])`):

1. `new GameAudioEngine()` and `new SoundBank()`.
2. `engine.initialize()` — creates the Web Audio context + buses.
3. `bank.loadAll(engine)` — loads every sound file in parallel.
4. `loadAudioSettings()` — read user preferences from localStorage.
5. Apply volumes to all four buses (`music` ← musicVolume, `ui` ← uiVolume, `sfx` ← inGameVolume, `ambient` ← inGameVolume).
6. `engine.setMasterVolume(settings.muted ? 0 : 1)`.
7. `setEngine(engine); setBank(bank); setIsReady(true)`.

After step 7 the React subtree re-renders, and any component that called `useUIAudio()` / `useGameAudio()` sees `isReady === true` and can start playing sounds.

**Cleanup** (return function of the effect): `engine.dispose()`, clear refs, clear state. In React StrictMode (dev), this runs once after the first mount; the second mount creates a new engine, which is the expected behavior.

**Music / ambient slot management:**

The four `play*Impl` helpers (`playMusicImpl`, `stopMusicImpl`, `playAmbientImpl`, `stopAmbientImpl`) implement the same pattern: only one music track and one ambient track can be active at a time.

- If you call `playMusic('music_dashboard')` while `music_dashboard` is already playing → no-op (avoids restart on re-render).
- If a different track is playing → stop it, start the new one, update the ref pair.
- `stopMusic()` halts the current track and clears the refs.

Because `playSceneMusic` / `playSceneAmbient` (game-facing) **alias the same impl helpers**, there is exactly one music slot and one ambient slot for the whole app, not one per consumer. This is intentional: when you enter a game, `MusicController` stops the menu music (because `/game/:id` isn't in its route table) and `GameCanvas` then starts `amb_forest` on the now-empty ambient slot. They never overlap in practice.

**In-game music shuffle playlist:**

The `playMusicPlaylistImpl` / `stopMusicPlaylistImpl` methods provide automatic track rotation for in-game music:

```ts
playMusicPlaylistImpl():
  1. Set playlistActiveRef = true
  2. Switch music bus volume to inGameVolume (from persisted settings)
  3. Call playNextPlaylistTrack()

playNextPlaylistTrack():
  1. Clean up any existing onEndedObservable observer
  2. Stop current track
  3. Pick a random variation from 'music_ingame' via bank.getRandomSound()
  4. Set loop = false (individual tracks don't loop)
  5. Play the track
  6. Register onEndedObservable.addOnce() → calls playNextPlaylistTrack() again

stopMusicPlaylistImpl():
  1. Set playlistActiveRef = false
  2. Remove onEndedObservable observer
  3. Stop current music
  4. Restore music bus volume to musicVolume (menu setting)
```

This creates an infinite jukebox that randomly rotates through all 5 in-game tracks. The `onEndedObservable` callback only fires if `playlistActiveRef` is still true, so stopping the playlist cleanly prevents orphaned callbacks.

**Global UI click sound:**

A separate effect attaches a document-level capture-phase click listener:

```ts
document.addEventListener('click', handler, true);
```

The capture phase guarantees the click sound still fires when child handlers call `e.stopPropagation()`. The handler walks up to the closest `button, a, [role="button"]`, skips disabled elements, and plays a randomised `ui_click` from the bank. This is why every clickable surface in the app produces a sound without each component having to wire it up individually.

**Two hooks:**

```ts
export function useUIAudio(): AudioHandle      // menu / UI consumers
export function useGameAudio(): GameAudioHandle // game consumers
```

Both throw if called outside `<AudioProvider>`. They return narrowed views of the same internal `AudioContextValue`.

### 4.5 `MusicController.tsx`

The thinnest possible React component — it returns `null` and only exists to map routes to music/ambient.

```ts
function resolveMusic(pathname): string | null {
  if (pathname === '/landing' || pathname === '/') return 'music_main_theme';
  if (DASHBOARD_ROUTES.has(pathname)) return 'music_dashboard';
  return null; // /auth, /game, /privacy, /terms → silence
}

function resolveAmbient(pathname): string | null {
  if (pathname === '/landing' || pathname === '/') return 'amb_montagne';
  return null;
}
```

A `useEffect([pathname, audio.isReady])` calls `audio.playMusic(...)` / `stopMusic()` / `playAmbient(...)` / `stopAmbient()` accordingly. Adding a new route track is one entry in `resolveMusic`/`resolveAmbient`, no plumbing.

When the route is `/game/:id`, both resolvers return `null`, so the controller stops the menu music and ambient — leaving the slots free for `GameCanvas` to start the shuffle playlist and scene ambient.

### 4.6 `AudioEventSystem.ts` and `triggerTables.ts`

This is the **gameplay** side of the system. It lives inside the `GameClient` class and turns inputs/snapshots/server events into sound playback calls.

The trigger tables in `triggerTables.ts` are pure data and define **three pipelines**:

#### Pipeline 1 — local input (edge-detected one-shots)

`LOCAL_INPUT_TRIGGERS` is an array of `{ soundId, field, edge, delayMs? }`.

```ts
[
  { soundId: 'player_jump',         field: 'isJumping',      edge: 'rising' },
  { soundId: 'player_land',         field: 'isGrounded',     edge: 'rising', initialValue: true },
  { soundId: 'player_attack_swing', field: 'isAttacking',    edge: 'rising', delayMs: 250 },
  { soundId: 'player_ability1',     field: 'isUsingAbility1', edge: 'rising', delayMs: 250 },
  { soundId: 'player_ability2',     field: 'isUsingAbility2', edge: 'rising', delayMs: 250 },
]
```

`AudioEventSystem.onLocalInput(input, position)` compares the current `InputState` against the previous frame, detects rising/falling edges on the watched fields, and plays the sound. `delayMs` is used to sync the sound with an animation (e.g. attack swing should land mid-anim, not on key press). Ability sounds are masked by cooldown timers to prevent audio spam when mashing buttons during cooldown.

#### Pipeline 1b — local continuous (interval-throttled loops)

`LOCAL_CONTINUOUS_TRIGGERS` keeps firing as long as a predicate stays true, with a minimum interval between plays.

```ts
[
  { soundId: 'player_footstep', predicate: isWalking, intervalMs: 550, volume: 0.2 },
  { soundId: 'player_footstep', predicate: isRunning, intervalMs: 320, volume: 0.4 },
]
```

`isWalking` = grounded + not sprinting + moving. `isRunning` = grounded + sprinting + moving. Interval is throttled per-sound with a `continuousTimers` Map, preventing spam.

#### Pipeline 2 — remote snapshot deltas

`REMOTE_SNAPSHOT_TRIGGERS` runs when the game receives a snapshot for a remote player. Each entry has a `predicate(prev, cur)` and an optional `volumeMapper`.

```ts
[
  // remote land — vertical velocity flipped from negative to ~zero
  { soundId: 'player_land',
    predicate: (prev, cur) => prev.velocity.y < -2 && cur.velocity.y >= -0.5,
    volumeMapper: (prev) => clamp(0.3, 1.0, |prev.velocity.y| / 20) },

  // remote jump — vertical velocity went from low to high
  { soundId: 'player_jump',
    predicate: (prev, cur) => prev.velocity.y <= 0.5 && cur.velocity.y > 5 },

  // remote footsteps — horizontal speed > threshold, throttled per player
  { soundId: 'player_footstep',
    predicate: (_, cur) => sqrt(cur.velocity.x² + cur.velocity.z²) > 2.0,
    throttled: true },
]
```

`throttled: true` enables an adaptive per-player rate limit so a remote player running across the arena doesn't fire 60 footsteps/second. The interval adapts to speed: `max(200, 500 - speedXZ * 15)`.

#### Pipeline 3 — game events (server messages)

`GAME_EVENT_TRIGGERS` is the most flexible pipeline. It dispatches on the discriminated union `GameEvent['type']` (Damage, Death, Spawn, AttackStarted, SkillUsed, …) using a type-safe `trigger()` helper that narrows the event type inside each callback.

```ts
trigger('Damage', {
  soundId: 'player_hit',
  predicate: (e, ctx) => e.attacker === ctx.localPlayerId,
  position: (e, ctx) => ctx.remotePositions.get(e.victim) ?? ctx.localPosition,
}),
trigger('Death', {
  soundId: 'player_death',
  position: (e, ctx) => /* victim position (local or remote) */,
}),
trigger('Spawn', {
  soundId: 'player_spawn',
  position: (e) => e.position,
}),
trigger('AttackStarted', {
  soundId: 'player_attack_swing',
  predicate: (e, ctx) => e.playerId !== ctx.localPlayerId, // remote only
  position: (e, ctx) => ctx.remotePositions.get(e.playerId),
}),
trigger('SkillUsed', {
  soundId: 'player_ability1',
  predicate: (e, ctx) => e.slot === 1 && e.playerId !== ctx.localPlayerId,
  position: (e, ctx) => ctx.remotePositions.get(e.playerId),
}),
trigger('SkillUsed', {
  soundId: 'player_ability2',
  predicate: (e, ctx) => e.slot === 2 && e.playerId !== ctx.localPlayerId,
  position: (e, ctx) => ctx.remotePositions.get(e.playerId),
}),
```

Adding a new gameplay sound for a server event is **one row** in `GAME_EVENT_TRIGGERS` — no new methods, no new class fields, no new wiring.

#### Class-aware sound resolution

When the local player is a Knight, calling `play('player_footstep')` should actually play `knight_footstep`. When they're a Rogue, `rogue_footstep`. This is handled by `AudioEventSystem.resolveSoundId()`:

```ts
private resolveSoundId(baseSoundId: string, characterClass?: string | null): string {
  if (!raw) return baseSoundId;
  const suffix = baseSoundId.replace(/^player_/, '');
  const classSpecificId = `${cls}_${suffix}`;
  if (this.soundBank.hasLoadedFiles(classSpecificId)) return classSpecificId;
  return baseSoundId; // fall back to generic
}
```

So `player_footstep` → `knight_footstep` if it exists in the bank (loaded from real files, not procedural), otherwise the generic stays. The class is set once at game start via `aes.setCharacterClass('knight')`.

For remote players, the class is looked up dynamically from a `characterClasses: ReadonlyMap<number, string>` passed in the context.

### 4.7 `AudioSettingsModal` (consumer)

Lives at `frontend/src/components/modals/AudioSettingsModal.tsx`. Renders three sliders — Music, UI, Game — split into a **Menu** section (Music + UI) and an **In-Game** section (Game), plus a global "Mute all sounds" checkbox.

Each slider change goes through one `update(patch)` function that:

1. Updates local state and persists via `saveAudioSettings()`.
2. Dispatches the new value to the engine through `useUIAudio()`:

```ts
if (patch.musicVolume  !== undefined) audio.setBusVolume('music', patch.musicVolume);
if (patch.uiVolume     !== undefined) audio.setBusVolume('ui',    patch.uiVolume);
if (patch.inGameVolume !== undefined) {
  audio.setBusVolume('sfx',     patch.inGameVolume);
  audio.setBusVolume('ambient', patch.inGameVolume);
  audio.setBusVolume('music',   patch.inGameVolume);
}
if (patch.muted !== undefined) audio.setMuted(patch.muted);
```

The Game slider fans out to **three buses** — `sfx`, `ambient`, and `music`. This means dragging Game Volume to zero silences all in-game audio: SFX, ambient loops, and in-game music. The Music slider in the Menu section also writes to the music bus, so whichever slider is changed last wins for the music bus volume.

In practice, the menu and game contexts never overlap: when you enter a game, the playlist start switches the music bus to `inGameVolume`, and when you leave, `stopMusicPlaylist` restores it to `musicVolume`.

Mute toggles `master.volume` between 0 and 1, which silences every downstream bus regardless of their individual volumes. Toggling mute off restores the previous slider positions because the slider state is persisted — the master simply goes back to 1.

Every slider exposes `aria-valuetext="N percent"` and the sections use `aria-labelledby` for screen-reader navigation.

### 4.8 `GameCanvas` (consumer)

Lives at `frontend/src/components/GameBoard/GameCanvas.tsx`. The file contains a React component that renders the Babylon canvas, owns the Babylon engine, and manages the game lifecycle. It constructs a `GameClient` class that runs the game loop, owns the player characters, the camera, and the `AudioEventSystem`.

The React component calls `useGameAudio()`, gates its main `useEffect` on `gameAudio.isReady`, and once the engine is ready it constructs the `GameClient` with the **shared** engine + bank passed as constructor arguments:

```tsx
const gameAudio = useGameAudio();

useEffect(() => {
  if (!canvasRef.current || !localPlayerId) return;
  if (!gameAudio.isReady || !gameAudio.engine || !gameAudio.soundBank) return;

  // …create Babylon engine + scene + camera…

  const gameClient = new GameClient(
    scene,
    localPlayerId,
    camera,
    characterConfig,
    characterClassesRef,
    gameAudio.engine,    // ← shared
    gameAudio.soundBank, // ← shared
  );

  gameAudio.playSceneAmbient('amb_forest');
  gameAudio.playMusicPlaylist();  // ← starts shuffled in-game music

  return () => {
    gameAudio.stopSceneAmbient();
    gameAudio.stopMusicPlaylist();  // ← stops playlist + restores menu music volume
    // …dispose Babylon scene + engine…
  };
}, [localPlayerId]);
```

Inside `GameClient`, the constructor attaches the listener to the local player's root node and wires up the `AudioEventSystem`:

```ts
constructor(scene, localPlayerID, camera, audioEngine, soundBank, ...) {
  // …
  audioEngine.attachListener(this.mgr.localCharacter.rootNode);
  const aes = new AudioEventSystem(audioEngine, soundBank);
  aes.setCharacterClass(characterConfig.label.toLowerCase());
  this.audioEventSystem = aes;
}
```

The class never disposes the engine. Engine ownership belongs to `AudioProvider` for the entire app lifetime — when the player leaves the game, only the local Babylon render engine and the scene are disposed; the audio engine keeps running for the menus.

---

## 5. End-to-end flows

### 5.1 App startup

```
1. <AudioProvider> mounts at app root
2. useEffect runs:
   ├─ new GameAudioEngine() / new SoundBank()
   ├─ engine.initialize()                       (~50 ms)
   ├─ bank.loadAll(engine)                      (parallel fetch of every WAV/MP3)
   ├─ apply persisted bus volumes
   │     music ← musicVolume, ui ← uiVolume,
   │     sfx ← inGameVolume, ambient ← inGameVolume
   ├─ apply persisted mute state
   └─ setIsReady(true) — re-render
3. <MusicController> picks up isReady, reads route, starts music_main_theme + amb_montagne
4. UI click handler activates
```

### 5.2 Navigating /landing → /home

```
1. Router updates pathname
2. MusicController useEffect re-runs:
   ├─ resolveMusic('/home')   = 'music_dashboard'
   ├─ resolveAmbient('/home') = null
3. audio.playMusic('music_dashboard') — switches from main_theme
4. audio.stopAmbient() — silences amb_montagne
```

### 5.3 Opening the settings modal and dragging Game Volume

```
1. User opens AudioSettingsModal (rendered from a button click)
2. Dragging the Game slider fires onChange(value/100)
3. update({ inGameVolume: 0.4 }) is called
   ├─ setSettings({ ...prev, inGameVolume: 0.4 })
   ├─ saveAudioSettings(...)              → localStorage
   ├─ audio.setBusVolume('sfx',     0.4)  → master>sfx>volume
   ├─ audio.setBusVolume('ambient', 0.4)  → master>ambient>volume
   └─ audio.setBusVolume('music',   0.4)  → master>music>volume
4. Live: every footstep, jump, ambient loop, AND in-game music is now at 40%
```

### 5.4 Entering a game, playing, leaving

```
1. Route changes to /game/:id
   └─ MusicController stops menu music + ambient (resolvers return null)

2. GameCanvas mounts
   ├─ gameAudio.isReady === true → effect runs
   ├─ Babylon engine + scene created
   ├─ new GameClient(scene, id, camera, engine, bank, …)
   │     └─ engine.attachListener(localPlayer.rootNode)
   │     └─ new AudioEventSystem(engine, bank).setCharacterClass('knight')
   ├─ gameAudio.playSceneAmbient('amb_forest')
   └─ gameAudio.playMusicPlaylist()
         ├─ music bus volume → inGameVolume
         └─ plays random track from music_ingame (5 variations)

3. Game loop: every frame
   ├─ aes.onLocalInput(input, position)
   │     └─ edge detection → player_jump, player_land
   │     └─ continuous → footsteps every 550ms/320ms
   │     └─ abilities (masked by cooldown timers)
   ├─ aes.onRemoteSnapshot(prev, cur) per remote player
   │     └─ remote land/jump/footstep based on velocity deltas
   │     └─ class-aware resolution per remote player
   └─ aes.onGameEvents(events, ctx)
         └─ Damage → player_hit at victim position
         └─ Death  → player_death at victim position
         └─ Spawn  → player_spawn at spawn position
         └─ AttackStarted → remote attack swing
         └─ SkillUsed → remote abilities

4. In-game music: when a track ends
   └─ onEndedObservable fires → playNextPlaylistTrack()
   └─ picks another random variation from music_ingame
   └─ infinite jukebox, never the same track twice in a row

5. Player navigates back to /home
   ├─ GameCanvas unmounts
   │     ├─ gameAudio.stopSceneAmbient()
   │     ├─ gameAudio.stopMusicPlaylist()
   │     │     └─ music bus volume → musicVolume (restored)
   │     ├─ Babylon scene + render engine disposed
   │     └─ Audio engine + bank stay alive (owned by AudioProvider)
   └─ MusicController route effect → music_dashboard
```

---

## 6. Extending the system

### Add a new sound file

1. Drop the WAV/MP3 under `frontend/public/sounds/...`.
2. Add a `SoundDefinition` row in `soundDefinitions.ts` with the file path, volume/pitch ranges, and target bus.
3. The bank picks it up automatically on next reload.

### Add a new gameplay trigger

- **One-shot from local input** (e.g. "dodge"): add a row to `LOCAL_INPUT_TRIGGERS` with `field: 'isDodging'` and edge.
- **Continuous loop while predicate true** (e.g. "channeling"): add a row to `LOCAL_CONTINUOUS_TRIGGERS` with a predicate and interval.
- **Reaction to remote snapshot** (e.g. "remote dodge"): add a row to `REMOTE_SNAPSHOT_TRIGGERS` with a `predicate(prev, cur)`.
- **Server-driven event** (e.g. "death scream"): add a `trigger('Death', { soundId, position, … })` row to `GAME_EVENT_TRIGGERS`. The `trigger()` helper narrows `event` to the right `GameEvent` variant inside the callback.

No code changes outside the table.

### Add a new menu route track

Edit `MusicController.tsx` and add a branch in `resolveMusic()` / `resolveAmbient()`. Done.

### Add in-game music tracks

Add more variation files to the existing `music_ingame` definition in `soundDefinitions.ts`:

```ts
{
  id: 'music_ingame',
  variations: [
    '/sounds/music/music_ingame_01.mp3',
    '/sounds/music/music_ingame_02.mp3',
    // add more here…
  ],
  // …
}
```

The shuffle playlist picks from all variations automatically — no code changes needed.

### Add a new bus

Edit `AudioEngine.initialize()` to call `createBusAsync('mybus', { outBus: master, volume: ... })` and store it in the `buses` map. Update `BusName` in `AudioProvider.tsx`. The settings modal gains a new slider only if the user should control it directly.

---

## 7. Persistence and defaults

```
localStorage key:  transcendence.audio_settings
shape:             { musicVolume, uiVolume, inGameVolume, muted }
defaults:          { musicVolume: 0.5, uiVolume: 0.7, inGameVolume: 1.0, muted: false }
clamp:             every numeric field clamped to [0, 1]
on parse error:    return defaults, never throw
on storage error:  silently ignore (private browsing, quota exceeded)
```

The defaults are intentionally asymmetric — music starts quieter than UI (which is in turn quieter than gameplay) so the first-time experience feels balanced without any user adjustment.

**Music bus volume context switching:** At init, the music bus uses `musicVolume` (menu context). When `playMusicPlaylist()` is called (entering game), the bus switches to `inGameVolume`. When `stopMusicPlaylist()` is called (leaving game), the bus reverts to `musicVolume`. The `inGameVolume` slider in the settings modal always writes to all three in-game buses (sfx + ambient + music), so changes take effect immediately regardless of context.

---

## 8. Why this shape?

A few decisions worth calling out:

- **Single engine, two hooks instead of two providers.** Earlier iterations had a separate audio engine inside `GameClient`. That meant the settings modal couldn't actually control gameplay audio, and "Mute all sounds" only muted the menus. Unifying into one engine owned by `AudioProvider` was a one-off refactor that eliminated a whole class of "the slider doesn't do anything" bugs.

- **Data tables instead of switch statements.** `triggerTables.ts` is the entire gameplay sound policy expressed as data. The `AudioEventSystem` class is the executor — it never has to grow when we add sounds. This is the same pattern as `MusicController` (route → music id table) and `SOUND_DEFINITIONS` (id → file paths).

- **Shared music/ambient slots between UI and game.** The `playSceneMusic` / `playSceneAmbient` methods of `useGameAudio()` are aliases of the UI `playMusic` / `playAmbient` — they share the same refs. In practice the menu side and game side never overlap (the route change stops menu audio before the game mounts), and sharing means there is exactly one music slot and one ambient slot in the entire app. No way to accidentally end up with two musics layered on top of each other.

- **Shuffle playlist via `onEndedObservable`.** Instead of looping a single track, in-game music uses Babylon's `onEndedObservable` to chain tracks. Each track plays once (`loop = false`), and when it ends, the callback picks a new random variation. This gives variety without any timer-based polling. The playlist is bounded to the game session — `stopMusicPlaylist()` removes the observer and restores the menu music bus volume.

- **Context-aware music bus volume.** The music bus serves both menu music (controlled by Music Volume slider) and in-game music (controlled by Game Volume slider). Rather than adding a separate bus, the volume is switched when entering/leaving a game. This keeps the bus topology simple while giving the user intuitive control in each context.

- **`isReady` gate on the game side.** The game React component early-returns from its main effect if the audio isn't ready yet, instead of buffering "play this sound when you can". This means the `GameClient` class can assume engine + bank are always available — no `if (engine)` checks scattered through the gameplay code.

- **Procedural fallbacks in `SoundBank`.** A missing WAV file shouldn't break the game. The bank synthesises a tone for jumps/lands/etc. so debug builds and partial asset checkouts still produce audible feedback at the right moments.

- **Master bus mute, not per-sound mute.** Implementing "mute all" by setting `master.volume = 0` is simpler than tracking which sounds are playing and pausing each one. Restoring volume is a single assignment, and individual slider positions are preserved across mute/unmute cycles automatically.

---

## 9. Reference: the AudioHandle and GameAudioHandle interfaces

```ts
// src/audio/AudioProvider.tsx

export type BusName = 'sfx' | 'music' | 'ambient' | 'ui';

export interface AudioHandle {
  isReady: boolean;
  playSound(soundId: string): void;
  playMusic(soundId: string): void;
  stopMusic(): void;
  playAmbient(soundId: string): void;
  stopAmbient(): void;
  setBusVolume(bus: BusName, volume: number): void;
  setMuted(muted: boolean): void;
}

export interface GameAudioHandle {
  isReady: boolean;
  engine: GameAudioEngine | null;
  soundBank: SoundBank | null;
  attachListener(node: Node): void;
  playSceneAmbient(soundId: string): void;
  stopSceneAmbient(): void;
  playSceneMusic(soundId: string): void;
  stopSceneMusic(): void;
  playMusicPlaylist(): void;
  stopMusicPlaylist(): void;
}

export function useUIAudio(): AudioHandle;
export function useGameAudio(): GameAudioHandle;
```

Both hooks throw if used outside `<AudioProvider>`.

---

## 10. Sound assets inventory

Located in `frontend/public/sounds/`:

| Category | Files |
|---|---|
| Music (menu) | `music_main_theme_01.wav`, `music_main_theme_02.wav`, `music_dashbord.mp3` |
| Music (in-game) | `music_ingame_01.mp3` through `music_ingame_05.mp3` |
| Ambient | `amb_montagne.wav`, `amb_forest.mp3` |
| UI | `ui_click.mp3`, `ui_notif.mp3`, `ui_ticking.wav`, `ui_lobby_join.mp3`, `ui_lobby_leave.mp3` |
| SFX — Movement (generic) | 4 jumps, 1 land, 5 footsteps |
| SFX — Movement (knight) | 3 jumps, 2 lands, 3 footsteps |
| SFX — Movement (rogue) | 3 jumps, 2 lands, 3 footsteps |
| SFX — Combat (generic) | 5 attack swings |
| SFX — Combat (knight) | 4 attack swings, 2 ability A, 1 ability F |
| SFX — Combat (rogue) | 4 attack swings |
| SFX — Impacts | `player_hit_01.wav`, `player_death.wav` |
| SFX — Spawning | `player_spawn.mp3` |

Total: ~56 audio files.
