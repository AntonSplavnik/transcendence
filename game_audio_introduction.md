# Game Audio System - Introduction

## Table of Contents

1. [Why an Audio System?](#1-why-an-audio-system)
2. [Industry References](#2-industry-references)
3. [Our Architecture](#3-our-architecture)
4. [Game Events: The Heart of the System](#4-game-events-the-heart-of-the-system)
5. [The 3-Pipeline Architecture](#5-the-3-pipeline-architecture)
6. [The Client-Side Audio Engine](#6-the-client-side-audio-engine)
7. [3D Spatial Audio](#7-3d-spatial-audio)
8. [Extending the Audio System](#8-extending-the-audio-system)
9. [What Is Implemented](#9-what-is-implemented)
10. [Next Steps](#10-next-steps)
11. [Sources](#11-sources)

---

## 1. Why an Audio System?

Audio in a multiplayer game is not a simple `playSound("jump.wav")`. There are specific constraints:

- **Synchronization**: the sound must match what's happening visually, for the local player AND remote players
- **Spatialization**: an enemy jumping 50 meters away must sound different from an enemy 2 meters away
- **Zero latency**: the local player must hear their own actions instantly (no network delay)
- **Variation**: hearing the exact same sound 500 times is unpleasant. We need pitch, volume, and file variations
- **Performance**: dozens of simultaneous sounds without saturating the CPU or creating audio artifacts
- **Extensibility**: adding a new sound (footsteps, attacks, spells) must be trivial

Our system is designed to address all of these constraints from the start.

---

## 2. Industry References

Our architecture is inspired by the audio middleware used by game industry Wwise & FMOD :

Key concepts:
- **Events**: the game sends semantic events ("Player_Jump"), not audio files
- **Sound Banks**: audio assets are pre-loaded and organized into banks
- **Mixer Bus**: hierarchy of audio buses (Master > SFX > Music > Ambience) for mixing
- Separation between game logic and audio playback
- Parametric randomization (pitch, volume)
- Priority system to manage concurrent sounds

### What We Retain

The fundamental principle is **separation of responsibilities**:

```
The game NEVER says "play jump_03.wav at volume 0.7"
The game says "a jump just occurred at position (x, y, z)"
The audio system decides HOW to play it
```

This separation allows changing, improving, or replacing any sound without touching gameplay code.

---

## 3. Our Architecture

Our game has three layers: the C++ engine (simulation), the Rust backend (networking), and the TypeScript/Babylon.js frontend (rendering + audio). Audio flows through all three:

```
C++ Game Engine              Rust Backend                Browser Client
+---------------------+     +--------------------+     +----------------------------+
|                     |     |                    |     |                            |
|  ECS Simulation     |     |  WebTransport      |     |  GameAudioEngine           |
|                     |     |  Server            |     |  (Babylon.js AudioEngineV2)|
|  Systems detect     | --> |  Drains events     | --> |    |                      |
|  actions:           | FFI |  via FFI           | WS  |    +-- AudioBus (Master)  |
|                     |     |                    |     |    |    +-- SFX Bus        |
|  "This player       |     |  Broadcasts to     |     |    |    +-- Music Bus      |
|   jumped"           |     |  all connected     |     |    |    +-- Ambient Bus    |
|  "This player       |     |  clients           |     |    |    +-- UI Bus         |
|   landed with       |     |                    |     |    |                      |
|   force X"          |     |  -> GameEvents msg |     |    +-- SoundBank          |
|                     |     |                    |     |    |    (StaticSound pool) |
|  -> GameEventQueue  |     |                    |     |    |                      |
|     (64 max buffer) |     |                    |     |    +-- AudioEventSystem   |
+---------------------+     +--------------------+     |         (orchestrator)    |
                                                        +----------------------------+
```

### Why Babylon.js AudioEngineV2?

The project already uses Babylon.js for 3D rendering (meshes, cameras, glTF animations). Rather than maintaining a custom Web Audio API layer, we use Babylon.js 8's `AudioEngineV2` which provides:

- **AudioBus routing** with volume control
- **StaticSound with `maxInstances`**
- **Built-in spatial audio** with `attach()` to scene nodes — the listener follows the camera automatically
- **Automatic audio context unlock** on user interaction — no manual `resume()` needed
- **`createSoundAsync()`** accepts URLs, `AudioBuffer`, or `StaticSoundBuffer` — works for both loaded assets and procedural fallbacks

### Data Flow

1. The **C++ engine** simulates the game. When an action occurs (jump, landing, hit), the corresponding ECS system creates a **GameEvent** and pushes it into a queue
2. The **Rust backend** drains this queue via FFI at each network tick, and **broadcasts** the events to all connected clients
3. The **frontend** receives these events and passes them to the **AudioEventSystem**, which decides what sound to play, at what volume, what pitch, and where in 3D space

### Data-Driven File Structure

The audio module follows a strict **4-file split** — adding a sound never requires touching logic code:

| File | Role | Modification |
|------|------|--------------|
| `AudioEngine.ts` | Babylon.js wrapper (buses, listener) | Never |
| `SoundBank.ts` | Loads and stores `StaticSound` instances | Never |
| `soundDefinitions.ts` | Sound metadata (paths, volume, pitch, bus, cooldown…) | **Append-only** |
| `triggerTables.ts` | Declarative tables: *when* to play *which* sound | **Append-only** |
| `AudioEventSystem.ts` | Pipeline loops over the trigger tables | Never (logic only) |
| `useAudio.ts` | React hook for non-game audio (menu, UI, lobby) | Never |

```
soundDefinitions.ts  → "what definition" (variations, volume, spatial…)
triggerTables.ts     → "when to play"   (one table per pipeline)
AudioEventSystem.ts  → "how to play"    (loops over the tables, playback)
useAudio.ts          → "public API"     (music, UI, out-of-game)
```

---

## 4. Game Events: The Heart of the System

### What Is a Game Event?

A Game Event is a structured notification that says: **"something happened in the game"**. It is NOT an audio instruction. It is a factual piece of information about gameplay.

An event contains:

| Field | Description | Example |
|-------|-------------|---------|
| **type** | What type of action | `Jump`, `Land`, `Hit`, `Death` |
| **playerID** | Who performed the action | `42` |
| **position** | Where it happened (x, y, z) | `(25.0, 0.0, 50.0)` |
| **param1** | Context-dependent parameter | Impact velocity for `Land` |
| **param2** | Reserved for future use | `0.0` |

### Why Events Instead of Direct Calls?

Imagine the naive alternative: the C++ engine directly calls "play a sound". Problems:

- The C++ engine has zero knowledge of audio (no Web Audio API, no wav files)
- The engine runs server-side, not client-side
- Each client must hear the sound differently (spatialization, volume based on distance)
- The local player must hear their own jump BEFORE the server confirms it

Events solve all of this: the engine describes **what happened**, each client independently decides **how to render it as audio**.

### Current and Future Event Types

| Type | Trigger | Parameter | Pipeline | Status |
|------|---------|-----------|----------|--------|
| `Jump` | Player leaves the ground | Jump velocity | Input (local) / Snapshot delta (remote) | Implemented |
| `Land` | Player touches the ground | Impact velocity | Server events (local) / Snapshot delta (remote) | Implemented |
| `Footstep` | Player walks/runs | Movement speed | Snapshot delta (remote) | Implemented |
| `Hit` | Player takes damage | Damage amount | Server events (all) | Planned |
| `Death` | Player dies | - | Server events (all) | Planned |
| `Attack` | Player attacks | Attack type | Input (local) / Server events (remote) | Planned |
| `Dodge` | Player dodges | - | Server events (all) | Planned |

### The GameEventQueue

Events are stored in a **fixed-size ring buffer** (64 events max per frame). This choice is deliberate:

- **Zero dynamic allocation**: no memory allocation during gameplay, predictable performance
- **Bounded size**: even in the worst case (64 players jumping simultaneously), the system won't overflow
- **Atomic drain**: the backend empties the queue in a single FFI operation, then it resets

---

## 5. The 3-Pipeline Architecture

Audio follows the same split as animations: local state is driven by input, remote state is driven by snapshots, and critical gameplay outcomes come from server events.

```
Input clavier (chaque frame)
  └→ updateLocalAnimation(input)                    [visuel local]
  └→ audioEventSystem.onLocalInput(input, pos)      [audio local, 0ms]

processSnapshot (20Hz)
  └→ updateRemoteAnimation(char)                    [visuel distant]
  └→ audioEventSystem.onRemoteSnapshot(prev, cur)   [audio distant, ~50ms]

GameEvents message (serveur)
  └→ audioEventSystem.onServerEvents(events)        [sons critiques tous joueurs]
```

### The 3 Pipelines

| Pipeline | Trigger | Latency | Players | Sounds |
|----------|---------|---------|---------|--------|
| **Input** | Keypress (each frame) | 0ms | Local only | Jump, Attack swing |
| **Snapshot delta** | N-1 vs N comparison (20Hz) | ~50ms | Remote only | Land, Jump, Footstep |
| **Server events** | `GameEvents` message | ~50ms | All | Hit, Death, Dodge |

### Pipeline 1 — `onLocalInput`

Driven by `LOCAL_INPUT_TRIGGERS` in `triggerTables.ts`. Each entry declares a boolean `field` of `InputState` and an `edge` (`rising` or `falling`). The pipeline loops over the table and fires sounds on the declared edge — no per-sound `if` blocks in the code:

```
Space key held down (isJumping = true)
    Frame 1: prev[isJumping]=false → rising edge → plays "player_jump" IMMEDIATELY (0ms)
    Frame 2: prev[isJumping]=true  → no rising edge → no duplicate
    ...
Server broadcasts Jump event for local player
    → skipLocal=true in SERVER_EVENT_TRIGGERS → filtered out in Pipeline 3
```

The `prevInputState` map is **auto-initialised at construction** from the entries in `LOCAL_INPUT_TRIGGERS` — there are no manual `prevInputWasX` booleans to maintain.

### Pipeline 2 — `onRemoteSnapshot`

Driven by `REMOTE_SNAPSHOT_TRIGGERS`. Each entry has a `predicate(prev, cur)` that returns true when the sound should fire, an optional `volumeMapper` for dynamic volume, and an optional `throttled` flag for footstep-style rate limiting:

- **Land**: `prev.velocity.y < -2 AND cur.velocity.y >= -0.5` → volume proportional to impact
- **Jump**: `prev.velocity.y <= 0.5 AND cur.velocity.y > 5` → standard volume
- **Footstep**: `speedXZ > 2.0` + `throttled: true` → per-player adaptive interval (faster movement = more frequent)

### Pipeline 3 — `onServerEvents`

Driven by `SERVER_EVENT_TRIGGERS`. Each entry maps an `eventType` to a `soundId`, with optional `skipLocal` (to avoid double-play with Pipeline 1) and `volumeMapper`:

- Jump: `skipLocal: true` — already played at 0ms via Pipeline 1
- Land: `volumeMapper` uses `event.param1` (impact velocity from the server)
- Hit, Death, Dodge: entries commented in the table, ready to uncomment

### Duplicate Suppression

When the server sends the local player's Jump event, Pipeline 3 **ignores it** (`skipLocal: true` in the trigger table). Without this, the player would hear the jump sound twice.

---

## 6. The Client-Side Audio Engine

### Component Overview

```
GameAudioEngine (wrapper around AudioEngineV2)
    |
    +-- AudioBus hierarchy (Babylon.js native)
    |     MainAudioBus (Master)
    |       +-- AudioBus "sfx"     (gameplay sounds, vol 80%)
    |       +-- AudioBus "music"   (background music, vol 50%)
    |       +-- AudioBus "ambient" (ambience, wind, crowd, vol 60%)
    |       +-- AudioBus "ui"      (clicks, notifications, vol 70%)
    |
    +-- SoundBank (asset manager)
    |     Loads sounds via createSoundAsync()
    |     Each sound is a StaticSound with maxInstances
    |     Manages variations (jump_01, jump_02, jump_03)
    |     Generates procedural fallbacks from AudioBuffers
    |
    +-- triggerTables (declarative data — the only place to edit)
    |     LOCAL_INPUT_TRIGGERS   : field + edge → soundId
    |     REMOTE_SNAPSHOT_TRIGGERS : predicate(prev, cur) → soundId
    |     SERVER_EVENT_TRIGGERS  : eventType → soundId
    |
    +-- AudioEventSystem (pipeline orchestrator)
    |     onLocalInput()     — loops over LOCAL_INPUT_TRIGGERS
    |     onRemoteSnapshot() — loops over REMOTE_SNAPSHOT_TRIGGERS
    |     onServerEvents()   — loops over SERVER_EVENT_TRIGGERS
    |     playSoundAt()      — shared playback method (cooldown, spatial, variation)
    |
    +-- useAudio (React hook for non-game components)
          playSound()       — one-shot UI / notification sound
          playMusic()       — looping music (replaces previous track)
          stopMusic()
          setBusVolume()    — per-category volume control
```

### AudioBus: Professional Mixing via Babylon.js

Just like in a recording studio or in Wwise, sounds don't go directly to the speakers. They pass through a **mixing bus hierarchy** — now managed natively by Babylon.js `AudioBus` and `MainAudioBus`:

```
[Jump Sound] ---> [SFX Bus: vol 80%] ---+
[Land Sound] ---> [SFX Bus: vol 80%] ---+---> [Master Bus] ---> Speakers
[Music]      ---> [Music Bus: vol 50%] -+
[Rain]       ---> [Ambient Bus: vol 60%]+
[Click]      ---> [UI Bus: vol 70%] ----+
```

Benefits:
- Lower the music volume without affecting SFX: `engine.getBus('music').volume = 0.3`
- Each sound is routed to its bus via the `outBus` option at creation time
- The player can adjust each category independently in the settings
- Babylon.js provides volume ramping for smooth transitions

### SoundBank: StaticSound Variations

Each sound is defined by a **SoundDefinition** that specifies:

- **Variations**: multiple URLs for the same sound (jump_01, jump_02, jump_03). Each variation is loaded as a separate `StaticSound`. On each playback, one is chosen randomly. This avoids the "broken record" effect of repeated sounds
- **Volume range**: volume varies slightly on each playback (e.g., 0.7 to 0.85)
- **Pitch range**: playback rate also varies (e.g., 0.95 to 1.05 = +/- 5%). This makes each jump subtly different
- **maxInstances**: Babylon.js natively limits concurrent playbacks per sound (default: 4). No custom pool needed
- **Cooldown**: minimum time between two playbacks of the same sound (anti-spam)
- **Priority**: when too many sounds are playing simultaneously, lower priority ones are skipped

### Procedural Fallback

If `.wav` files are not available, the SoundBank generates synthesized sounds by creating `AudioBuffer` objects programmatically and passing them to `createSoundAsync()`:

- **Jump**: short rising chirp (frequency 200 -> 600 Hz over 120ms)
- **Land**: muffled impact (low frequency 80 Hz + white noise, fast decay)

This allows testing and development without needing finalized audio assets. The procedural sounds are wrapped in the same `StaticSound` interface, so the AudioEventSystem treats them identically.

### useAudio: React Hook for Non-Game Components

Components outside the game loop (menus, lobby, settings) use the `useAudio` hook instead of accessing the game's `AudioEventSystem` directly:

```typescript
function MainMenu() {
  const audio = useAudio();

  useEffect(() => {
    if (audio.isReady) audio.playMusic('menu_theme');
    return () => audio.stopMusic();
  }, [audio.isReady]);

  return <button onClick={() => audio.playSound('ui_click')}>Play</button>;
}
```

The hook creates its own `GameAudioEngine` + `SoundBank` instance. If the game and menus ever need to share a single engine (e.g., to avoid reloading assets), the hook can be lifted into a React context (`AudioProvider`) — the call sites would not change.

---

## 7. 3D Spatial Audio

### The Principle

Babylon.js AudioEngineV2 provides built-in **spatial audio** on every `StaticSound` and `AudioBus`. Our system uses it for gameplay sounds:

- A player jumping to your left -> louder in the left ear
- A player landing 50 meters away -> attenuated sound
- A player right next to you -> full volume sound

### Listener Attachment

The audio listener is **attached to the camera** via `engine.listener.attach(camera)`. This means:
- The listener position and orientation update automatically as the camera moves
- No manual position updates needed each frame
- The listener follows the player's perspective naturally

### Spatialization Parameters

Each SoundDefinition defines:
- **minDistance** (5m): distance below which the sound is at full volume
- **maxDistance** (50m): distance beyond which the sound is inaudible
- **Distance model**: `inverse` (natural 1/distance attenuation)
- **Panning model**: `HRTF` (Head-Related Transfer Function, binaural simulation)

Before playing a sound, `playSoundAt()` sets `sound.spatial.position` to the event's world position. Babylon.js handles the rest (attenuation, panning, HRTF).

### Exception: The Local Player

Local player sounds are played without modifying the spatial position relative to the listener. Since the listener is attached to the camera which follows the local player, these sounds are heard at full volume. This is standard behavior in all games.

---

## 8. Extending the Audio System

Adding a sound is always the same 3-step process regardless of which pipeline it belongs to:

### New server event (e.g. `player_hit`)

```
1. Add hit_01.wav, hit_02.wav to /sounds/sfx/

2. Append to soundDefinitions.ts:
   { id: 'player_hit', variations: [...], bus: 'sfx', priority: 8, ... }

3. Append to SERVER_EVENT_TRIGGERS in triggerTables.ts:
   { eventType: GameEventType.Hit, soundId: 'player_hit' }

→ Done. No other file touched.
```

### New local input (e.g. `player_dodge`)

```
1. Add dodge.wav to /sounds/sfx/

2. Append to soundDefinitions.ts:
   { id: 'player_dodge', variations: [...], bus: 'sfx', priority: 6, ... }

3. Append to LOCAL_INPUT_TRIGGERS in triggerTables.ts:
   { soundId: 'player_dodge', field: 'isDodging', edge: 'rising' }
   (also add isDodging to InputState if not already there)

→ Done.
```

### Menu music

```
1. Add menu_theme.mp3 to /sounds/music/

2. Append to soundDefinitions.ts:
   { id: 'menu_theme', variations: [...], bus: 'music', spatial: false, ... }

3. In the menu component:
   const audio = useAudio();
   audio.playMusic('menu_theme');

→ Done. No modification to the game audio system.
```

### Sound priority guidelines

| Category | `priority` | `bus` |
|----------|-----------|-------|
| Critical (hit, death) | 8–10 | sfx |
| Important (jump, land, attack) | 5–7 | sfx |
| Ambient gameplay (footstep) | 1–3 | sfx |
| Music | — | music |
| UI | 5 | ui |
| Ambiance | — | ambient |

---

## 9. What Is Implemented

### Architecture

| File | Status | Description |
|------|--------|-------------|
| `AudioEngine.ts` | Done | Babylon.js wrapper, 4 buses, listener attachment |
| `SoundBank.ts` | Done | StaticSound loader, variations, procedural fallback |
| `soundDefinitions.ts` | Done | 3 sounds: jump, land, footstep |
| `triggerTables.ts` | Done | 3 trigger tables (data-driven) |
| `AudioEventSystem.ts` | Done | 3 pipeline loops, no per-sound logic |
| `useAudio.ts` | Done | React hook for non-game audio |

### 3-Pipeline Coverage

| Pipeline | Method | Status |
|----------|--------|--------|
| Input (local, 0ms) | `onLocalInput(input, pos)` | Implemented — Jump |
| Snapshot delta (remote, ~50ms) | `onRemoteSnapshot(prev, cur)` | Implemented — Jump, Land, Footstep |
| Server events (all, ~50ms) | `onServerEvents(events)` | Implemented — Jump, Land |

### Complete Chain
- C++: event emission -> queue -> FFI
- Rust: event drain -> WebTransport broadcast
- TypeScript: reception -> AudioEventSystem -> Babylon.js AudioEngineV2

### Audio Stack
- `GameAudioEngine`: wrapper around `AudioEngineV2` with bus hierarchy
- `SoundBank`: loads `StaticSound` instances, procedural fallbacks
- `triggerTables`: declarative trigger definitions for all 3 pipelines
- `AudioEventSystem`: loops over tables, no per-sound conditionals
- `useAudio`: hook for menus and UI components
- Automatic audio context unlock (Babylon.js)
- Listener attached to camera for automatic spatial updates

### Sounds
- `player_jump`: local at 0ms (Pipeline 1), remote via velocity delta (Pipeline 2), server event filtered for local player
- `player_land`: server events with `param1`-based volume, velocity delta for remote players
- `player_footstep`: remote players, speed-adaptive interval, per-player timer
- Procedural fallbacks (no .wav files needed for testing)
- Pitch and volume variation per playback
- Anti-spam cooldown per sound ID

---

## 10. Next Steps

### Short Term
- [ ] Add real audio assets (.wav) for jump and land
- [ ] Uncomment `Hit` and `Death` in `SERVER_EVENT_TRIGGERS` (entries already there)
- [ ] Add Attack swing sound via `LOCAL_INPUT_TRIGGERS` (entry already commented)

### Medium Term
- [ ] Background music via `useAudio` in the menu/lobby components
- [ ] UI for adjusting volumes per bus — `useAudio.setBusVolume()` already available
- [ ] Ambient sounds (wind, crowd) appended to `soundDefinitions.ts`
- [ ] Attach spatial sounds to remote player meshes via `sound.spatial.attach(mesh)`

### Long Term
- [ ] Reverb/echo system based on environment
- [ ] Adaptive music (changes based on combat intensity)
- [ ] Audio occlusion (walls blocking sound)
- [ ] Shared `AudioProvider` context if game and menus need the same engine instance

---

## Glossary

| Term | Definition |
|------|-----------|
| **Game Event** | Structured notification describing a gameplay action (jump, landing, hit) |
| **GameEventQueue** | Fixed-size circular buffer (64) storing events for a frame |
| **FFI** | Foreign Function Interface - bridge between C++ and Rust |
| **AudioEngineV2** | Babylon.js 8 modern audio engine, decoupled from the scene, with spatial audio and bus routing |
| **GameAudioEngine** | Our wrapper around AudioEngineV2 that manages the bus hierarchy |
| **AudioBus / MainAudioBus** | Babylon.js native audio bus nodes for mixing hierarchy and volume control |
| **StaticSound** | Babylon.js pre-loaded sound with `maxInstances`, spatial audio, and playback rate control |
| **SoundBank** | Registry of sound definitions with their pre-loaded `StaticSound` instances |
| **SoundDefinition** | Configuration for a sound: URLs, volume, pitch, priority, cooldown, maxInstances |
| **triggerTables** | Declarative data tables that define when each sound fires (one per pipeline) |
| **LocalInputTrigger** | Entry in Pipeline 1 table: a boolean InputState field + rising/falling edge |
| **RemoteSnapshotTrigger** | Entry in Pipeline 2 table: a predicate over two CharacterSnapshots |
| **ServerEventTrigger** | Entry in Pipeline 3 table: a GameEventType mapped to a soundId |
| **AudioEventSystem** | Orchestrator that loops over trigger tables and dispatches playback |
| **useAudio** | React hook exposing playSound/playMusic/setBusVolume for non-game components |
| **Hybrid Prediction** | Strategy where the local player hears their sounds immediately, remote sounds arrive via the server |
| **HRTF** | Head-Related Transfer Function - 3D audio simulation for stereo headphones |
| **Drain** | Queue emptying operation (read + clear in a single atomic operation) |
| **Rolloff** | Volume attenuation as a function of source-listener distance |

## 11. Sources

FMOD - https://www.fmod.com/
Wwise - https://www.audiokinetic.com/fr/wwise/
