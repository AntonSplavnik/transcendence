# Game Audio System - Introduction

## Table of Contents

1. [Why Audio System?](#1-why-audio-system)
2. [Industry References](#2-industry-references)
3. [Our Architecture](#3-our-architecture)
4. [Game Events: The Heart of the System](#4-game-events-the-heart-of-the-system)
5. [The Journey of a Sound: From Action to Speaker](#5-the-journey-of-a-sound-from-action-to-speaker)
6. [The Latency Problem: Hybrid Prediction](#6-the-latency-problem-hybrid-prediction)
7. [The Client-Side Audio Engine](#7-the-client-side-audio-engine)
8. [3D Spatial Audio](#8-3d-spatial-audio)
9. [What Is Implemented Today](#9-what-is-implemented-today)
10. [Next Steps](#10-next-steps)

---

## 1. Why a Audio System?

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

Our architecture is inspired by the audio middleware used by AAA studios:

### Wwise (Audiokinetic)
Used by Overwatch, Assassin's Creed, Cyberpunk 2077. Key concepts:
- **Events**: the game sends semantic events ("Player_Jump"), not audio files
- **Sound Banks**: audio assets are pre-loaded and organized into banks
- **Mixer Bus**: hierarchy of audio buses (Master > SFX > Music > Ambience) for mixing

### FMOD
Used by Fortnite, Celeste, Hades. Same fundamental principles:
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

- **AudioBus routing** with volume control — replaces our custom `MixerBus`
- **StaticSound with `maxInstances`** — replaces our custom `SoundPool` (concurrency managed natively)
- **Built-in spatial audio** with `attach()` to scene nodes — the listener follows the camera automatically
- **Automatic audio context unlock** on user interaction — no manual `resume()` needed
- **`createSoundAsync()`** accepts URLs, `AudioBuffer`, or `StaticSoundBuffer` — works for both loaded assets and procedural fallbacks

This eliminates ~200 lines of custom plumbing (`MixerBus`, `SoundPool`, `SoundInstance`) while gaining features like volume ramping, sound cloning, and mesh attachment.

### Data Flow

1. The **C++ engine** simulates the game at 60 Hz. When an action occurs (jump, landing, hit), the corresponding ECS system creates a **GameEvent** and pushes it into a queue
2. The **Rust backend** drains this queue via FFI at each network tick, and **broadcasts** the events to all connected clients
3. The **frontend** receives these events and passes them to the **AudioEventSystem**, which decides what sound to play, at what volume, what pitch, and where in 3D space

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

| Type | Trigger | Parameter | Status |
|------|---------|-----------|--------|
| `Jump` | Player leaves the ground | Jump velocity | Implemented |
| `Land` | Player touches the ground | Impact velocity | Implemented |
| `Hit` | Player takes damage | Damage amount | Planned |
| `Death` | Player dies | - | Planned |
| `Footstep` | Player walks/runs | Movement speed | Planned |
| `Attack` | Player attacks | Attack type | Planned |
| `Dodge` | Player dodges | - | Planned |

### The GameEventQueue

Events are stored in a **fixed-size ring buffer** (64 events max per frame). This choice is deliberate:

- **Zero dynamic allocation**: no memory allocation during gameplay, predictable performance
- **Bounded size**: even in the worst case (64 players jumping simultaneously), the system won't overflow
- **Atomic drain**: the backend empties the queue in a single FFI operation, then it resets

---

## 5. The Journey of a Sound: From Action to Speaker

Let's take the concrete example of landing after a jump:

```
Frame N: Player is airborne (velocity.y = -15.0, isGrounded = false)
    |
    v
Frame N+1: PhysicsSystem detects the player touching the ground
    |
    |  1. wasGrounded = false, isGrounded = true -> TRANSITION detected
    |  2. GameEvent { type: Land, playerID: 42, pos: (25, 0, 50), param1: 15.0 }
    |  3. Event pushed into the GameEventQueue
    |
    v
Network tick (16.67ms): Rust backend drains the queue via FFI
    |
    |  4. game_drain_events() -> [{ Land, player 42, impact 15.0 }]
    |  5. Broadcasts GameServerMessage::GameEvents to all clients
    |
    v
Client A (player 42, the local player):
    |  6. Receives the event but player_id == localPlayerId -> IGNORED
    |     (sound was already played locally, see section 6)
    |
Client B (remote player):
    |  6. Receives the event, player_id != localPlayerId -> PROCESSED
    |  7. AudioEventSystem.mapEventToSound(Land):
    |     - soundId = "player_land"
    |     - volume = clamp(15.0 / 20.0, 0.3, 1.0) = 0.75 (medium landing)
    |     - pitch = random(0.9, 1.1)
    |  8. SoundBank.getRandomSound("player_land") -> StaticSound (random variation)
    |  9. StaticSound.play() with spatial position (25, 0, 50) -> 3D spatial sound
    |
    v
Player B hears a "thud" more or less loud depending on distance
```

---

## 6. The Latency Problem: Hybrid Prediction

### The Problem

In a multiplayer game, there is a network delay between the action and its confirmation by the server (~50-100ms). If we wait for the server event to play the local player's sound, they will perceive an unpleasant gap between pressing Space and hearing the jump sound.

### The Solution: Just Like AAA Games

Professional games (Overwatch, Valorant, Rocket League) all use the same strategy: **hybrid prediction**.

| Source | Audio Trigger | Latency | Why |
|--------|--------------|---------|-----|
| **Local player** | Client-side, on key press | **0 ms** | Instant feedback, essential for game feel |
| **Remote players** | Server events via network | ~50-100 ms | Synchronized with visuals; the delay is imperceptible for other players' actions |

### How It Works in Practice

**For the local player (prediction):**
```
Space key pressed
    -> Client plays "player_jump" IMMEDIATELY (0ms delay)
    -> Client sends input to server
    -> Server confirms the jump, broadcasts the event
    -> Client receives the event but FILTERS it (player_id == localPlayerId)
    -> No double sound
```

**For remote players (server-authoritative):**
```
Server broadcasts Jump event for player 42
    -> Player 7's client receives the event
    -> player_id 42 != localPlayerId 7 -> process it
    -> Sound played with 3D spatialization at player 42's position
```

### Duplicate Suppression

The crucial point: when the server sends the local player's jump event, the client **ignores it** because it was already played via prediction. Without this suppression, the player would hear the jump sound twice.

---

## 7. The Client-Side Audio Engine

### Component Overview

The audio engine is composed of 3 modules built on top of Babylon.js AudioEngineV2:

```
GameAudioEngine (wrapper around AudioEngineV2)
    |
    +-- AudioBus hierarchy (Babylon.js native)
    |     MainAudioBus (Master)
    |       +-- AudioBus "sfx" (gameplay sounds, vol 80%)
    |       +-- AudioBus "music" (background music, vol 50%)
    |       +-- AudioBus "ambient" (ambience, wind, crowd, vol 60%)
    |       +-- AudioBus "ui" (clicks, notifications, vol 70%)
    |
    +-- SoundBank (asset manager)
    |     Loads sounds via createSoundAsync()
    |     Each sound is a StaticSound with maxInstances
    |     Manages variations (jump_01, jump_02, jump_03)
    |     Generates procedural fallbacks from AudioBuffers
    |
    +-- AudioEventSystem (orchestrator)
          Receives Game Events
          Maps event -> sound (type, volume, pitch)
          Sets spatial position on StaticSound before play()
          Manages anti-spam cooldowns
          Filters local player events
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

---

## 8. 3D Spatial Audio

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

Before playing a sound, the AudioEventSystem sets `sound.spatial.position` to the event's world position. Babylon.js handles the rest (attenuation, panning, HRTF).

### Exception: The Local Player

Local player sounds are played without modifying the spatial position relative to the listener. Since the listener is attached to the camera which follows the local player, these sounds are heard at full volume. This is standard behavior in all games.

---

## 9. What Is Implemented

### Functional Test Events
- **Jump**: detected in CharacterControllerSystem when the player leaves the ground
- **Land**: detected in PhysicsSystem via the `wasGrounded=false -> isGrounded=true` transition

### Complete Chain
- C++: event emission -> queue -> FFI
- Rust: event drain -> WebTransport broadcast
- TypeScript: reception -> AudioEventSystem -> Babylon.js AudioEngineV2

### Audio Stack (Babylon.js AudioEngineV2)
- `GameAudioEngine`: wrapper around `AudioEngineV2` with bus hierarchy
- `SoundBank`: loads `StaticSound` instances via `createSoundAsync()`, with procedural fallbacks
- `AudioEventSystem`: maps game events to sounds, sets spatial position, manages cooldowns
- Automatic audio context unlock (handled by Babylon.js)
- Listener attached to camera for automatic spatial updates

### Sounds
- Functional procedural fallbacks (no .wav files needed for testing)
- Pitch and volume variation on each playback
- Anti-spam cooldown
- Local player filtering (no double sound)
- State verification (jump sound only plays when the player is grounded)

---

## 10. Next Steps

### Short Term
- [ ] Add real audio assets (.wav) for jump and land
- [ ] Implement `Hit` and `Death` events
- [ ] Add footstep sounds (`Footstep`) tied to movement speed

### Medium Term
- [ ] Attack sounds with variations based on weapon type
- [ ] Background music with dedicated bus
- [ ] UI for adjusting volumes per bus (SFX, Music, etc.)
- [ ] Ambient sounds (wind, crowd)
- [ ] Attach spatial sounds to remote player meshes via `sound.spatial.attach(mesh)`

### Long Term
- [ ] Reverb/echo system based on environment
- [ ] Adaptive music (changes based on combat intensity)
- [ ] Audio occlusion (walls blocking sound)

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
| **AudioEventSystem** | Orchestrator that maps game events to sounds with spatial positioning |
| **Hybrid Prediction** | Strategy where the local player hears their sounds immediately, remote sounds arrive via the server |
| **HRTF** | Head-Related Transfer Function - 3D audio simulation for stereo headphones |
| **Drain** | Queue emptying operation (read + clear in a single atomic operation) |
| **Rolloff** | Volume attenuation as a function of source-listener distance |
