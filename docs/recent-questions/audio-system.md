# Audio System Architecture

**Status**: Phase 1 In Progress
**Authors**: asplavnic (Anton Splavnik)
**Last Updated**: 2026-02-27

## Overview

This document describes the audio system for the Transcendence arena game. The implementation follows a two-phase approach that accounts for the current state of client-side prediction being disabled and future integration when predictions are re-enabled.

## Design Philosophy

The audio system is designed with these principles:

1. **Phased Implementation**: Start with client-side audio, extend to server-synchronized events later
2. **Extensibility**: Architecture supports both modes without requiring rewrites
3. **Performance**: Audio pooling, preloading, and spatial distance culling
4. **Immersion**: 3D spatial audio using Babylon.js Sound API
5. **User Control**: Volume controls per category (SFX, Music, Ambient)

---

## Phase 1: Client-Side Audio (Current)

### Scope

Phase 1 implements audio that works entirely on the client without requiring server-side audio events:

✅ **Implemented Sounds**:
- Footsteps (walk/run variations)
- Jump sounds (start, land)
- Sword swings (attack wind-up)
- Background music (menu, battle)
- Ambient sounds (arena crowd)

❌ **Deferred to Phase 2**:
- Hit impact sounds (require server confirmation)
- Death sounds (require server confirmation)
- Projectile impacts
- Ability sound effects
- Player join/leave notifications

### Why This Works Without Predictions

**Footsteps**: Driven by character velocity from server snapshots. Each client plays footsteps independently based on received character positions and velocities. No prediction needed.

**Music/Ambient**: Completely local, no network dependency.

**Sword Swings**:
- For **local player**: Played on input (has ~50-100ms latency, but acceptable)
- For **remote players**: Played on character state transitions (Idle → Attacking) from snapshots
- Not perfect, but sufficient for Phase 1

---

## Architecture

### File Structure

```
frontend/
├── public/
│   └── audio/
│       ├── sfx/
│       │   ├── movement/
│       │   │   ├── footstep_walk_1.mp3
│       │   │   ├── footstep_walk_2.mp3
│       │   │   ├── footstep_walk_3.mp3
│       │   │   ├── footstep_run_1.mp3
│       │   │   ├── footstep_run_2.mp3
│       │   │   ├── jump.mp3
│       │   │   └── land.mp3
│       │   └── combat/
│       │       ├── sword_swing_1.mp3
│       │       ├── sword_swing_2.mp3
│       │       └── sword_swing_3.mp3
│       ├── music/
│       │   ├── menu_theme.mp3
│       │   └── battle_loop.mp3
│       └── ambient/
│           └── arena_crowd.mp3
└── src/
    └── audio/
        ├── SoundManager.ts     # Core audio system
        └── config.ts           # Audio configuration (optional)
```

### SoundManager Class

Located at `frontend/src/audio/SoundManager.ts`, this is the core audio engine.

**Key Features**:
- Sound preloading and pooling
- Spatial 3D audio positioning
- Random variation selection (avoid repetition)
- Volume controls per category
- Footstep timing system
- Music track management

**Public API**:

```typescript
class SoundManager {
  // Initialization
  constructor(scene: Scene)
  async preloadPhase1Sounds(): Promise<void>

  // Sound playback
  play(soundName: string, position?: Vector3): void

  // Footsteps (called every frame)
  updateFootsteps(
    characterId: number,
    position: Vector3,
    velocity: Vector3,
    isGrounded: boolean,
    isSprinting: boolean
  ): void

  // Music
  playMusic(trackName: string): void
  stopMusic(): void

  // Volume control
  setVolume(category: 'master' | 'sfx' | 'music' | 'ambient', volume: number): void
}
```

---

## Integration Points

### 1. Game Client Initialization

In `SimpleGameClient.tsx`, initialize the sound manager when the Babylon.js scene is created:

```typescript
useEffect(() => {
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);

  // Initialize audio
  const soundManager = new SoundManager(scene);
  await soundManager.preloadPhase1Sounds();
  soundManager.playMusic('battle');

  // ... rest of setup
}, []);
```

### 2. Game Loop (Footsteps)

In the `onBeforeRenderObservable` callback, update footsteps for all characters:

```typescript
scene.onBeforeRenderObservable.add(() => {
  characters.forEach(char => {
    const position = new Vector3(char.position.x, char.position.y, char.position.z);
    const velocity = new Vector3(char.velocity.x, char.velocity.y, char.velocity.z);
    const isGrounded = Math.abs(char.velocity.y) < 0.1;
    const isSprinting = char.state === CharacterState.Moving && velocity.length() > 10;

    soundManager.updateFootsteps(
      char.player_id,
      position,
      velocity,
      isGrounded,
      isSprinting
    );
  });
});
```

### 3. Input Handling (Local Actions)

Play immediate audio feedback for local player actions:

```typescript
function handleInput(input: InputState) {
  if (input.isJumping && myCharacter.isGrounded) {
    const pos = new Vector3(myCharacter.position.x, myCharacter.position.y, myCharacter.position.z);
    soundManager.play('jump', pos);
  }

  gameStream.send({ type: 'Input', input });
}
```

### 4. State Transitions (Attacks)

Detect character state changes in snapshot processing:

```typescript
characters.forEach(char => {
  const prevState = previousStates.get(char.player_id);

  if (prevState !== CharacterState.Attacking && char.state === CharacterState.Attacking) {
    const position = new Vector3(char.position.x, char.position.y, char.position.z);
    soundManager.play('sword_swing', position);
  }

  previousStates.set(char.player_id, char.state);
});
```

---

## Technical Specifications

### Audio Format

- **SFX**: OGG or MP3, 44.1kHz, 128kbps, mono preferred
- **Music**: MP3, 44.1kHz, 320kbps, stereo
- **Ambient**: MP3, 44.1kHz, 192kbps, stereo

### Babylon.js Sound Configuration

```typescript
new Sound(name, url, scene, null, {
  spatialSound: true,
  maxDistance: 50,        // Hearing distance (game units)
  refDistance: 1,         // Full volume distance
  rolloffFactor: 1.5,     // How fast volume decreases with distance
  volume: 1.0
})
```

### Footstep Timing

- **Walk**: 500ms interval between steps
- **Run**: 300ms interval between steps
- **Logic**: Based on horizontal velocity magnitude

### Performance Considerations

- **Sound pooling**: Multiple instances per sound for variations
- **Distance culling**: Sounds beyond `maxDistance` (50 units) don't play
- **Concurrent limit**: Babylon.js handles this automatically, typically 16-32 sounds
- **Preloading**: All Phase 1 sounds loaded at game start (~3-5MB total)

---

## Phase 2: Server-Synchronized Audio (Future)

### When Predictions Are Re-Enabled

Phase 2 extends the system to support:
- Server-confirmed hit impacts
- Server-confirmed death sounds
- Predicted local actions (instant feedback)
- Projectile impacts
- Game events (player joined/left)

### Backend Changes Required

#### 1. Add Audio Events to Message Protocol

In `backend/src/game/mod.rs`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum AudioEvent {
    HitImpact {
        position: Vector3D,
        attacker_id: PlayerId,
        victim_id: PlayerId,
        damage: f32,
    },
    Death {
        position: Vector3D,
        player_id: PlayerId,
    },
    ProjectileLaunch {
        position: Vector3D,
        entity_id: EntityId,
    },
    ProjectileHit {
        position: Vector3D,
        entity_id: EntityId,
    },
    PlayerJoined {
        player_id: PlayerId,
        name: String,
    },
    PlayerLeft {
        player_id: PlayerId,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum GameServerMessage {
    Snapshot(GameStateSnapshot),
    AudioEvent(AudioEvent),  // NEW
    PlayerJoined { player_id: PlayerId, name: String },
    PlayerLeft { player_id: PlayerId },
    Error(String),
}
```

#### 2. Trigger Events from Game Logic

In C++ combat system (`game_engine/src/` or bindings):

```cpp
void CombatSystem::registerHit(EntityID attacker, EntityID victim, float damage) {
    applyDamage(victim, damage);

    // Send audio event
    auto* transform = registry.try_get<Transform>(victim);
    if (transform) {
        game->sendAudioEvent(AudioEvent::HitImpact {
            position: transform->position,
            attacker_id: getPlayerID(attacker),
            victim_id: getPlayerID(victim),
            damage: damage
        });
    }

    // Check for death
    auto* health = registry.try_get<Health>(victim);
    if (health && health->current <= 0) {
        game->sendAudioEvent(AudioEvent::Death {
            position: transform->position,
            player_id: getPlayerID(victim)
        });
    }
}
```

Or in Rust game loop:

```rust
pub fn process_attack(&mut self, player_id: PlayerId) {
    // Call C++ game logic
    unsafe { game_register_hit(self.game_ptr, attacker_id, victim_id, damage) };

    // Broadcast audio event
    let audio_event = AudioEvent::HitImpact {
        position: victim_position,
        attacker_id,
        victim_id,
        damage,
    };

    self.broadcast_audio_event(audio_event);
}

fn broadcast_audio_event(&mut self, event: AudioEvent) {
    for client in &mut self.clients {
        client.send(GameServerMessage::AudioEvent(event.clone()));
    }
}
```

### Frontend Extensions (Phase 2)

Add to `SoundManager.ts`:

```typescript
// NEW METHOD for Phase 2
handleServerAudioEvent(event: AudioEvent) {
  switch (event.type) {
    case 'HitImpact':
      const impactSound = event.damage > 30 ? 'hit_heavy' : 'hit_light';
      this.play(impactSound, new Vector3(event.position.x, event.position.y, event.position.z));
      break;

    case 'Death':
      const pos = new Vector3(event.position.x, event.position.y, event.position.z);
      this.play('death_grunt', pos);
      this.play('body_fall', pos, { delay: 200 });
      break;

    case 'ProjectileHit':
      this.play('projectile_impact', new Vector3(event.position.x, event.position.y, event.position.z));
      break;

    case 'PlayerJoined':
      this.playUI('player_joined');
      break;

    case 'PlayerLeft':
      this.playUI('player_left');
      break;
  }
}
```

Handle in game client:

```typescript
async processGameMessages(stream: GameStream) {
  for await (const message of stream.receive()) {
    if (message.type === 'Snapshot') {
      this.handleSnapshot(message.data);
    } else if (message.type === 'AudioEvent') {
      soundManager.handleServerAudioEvent(message.data);
    }
  }
}
```

### Prediction + Audio

With predictions enabled, local actions play instantly:

```typescript
// Phase 2: Instant local feedback
function handleLocalAttack() {
  // Play sound immediately (prediction)
  soundManager.play('sword_swing', myCharacter.position);

  // Send to server
  gameStream.send({ type: 'Input', isAttacking: true });

  // Server will later send AudioEvent::HitImpact if hit confirms
}
```

### Synchronization Strategy

**Hybrid Approach**:
- **Immediate**: Own footsteps, own attack swings, UI sounds, music
- **Server-confirmed**: Hit impacts, deaths, projectile impacts, game events

**Flow Example**:

```
[Player 1] Press Attack Button
    ↓
[Client 1] Play "sword_swing" sound (IMMEDIATE)
    ↓
[Client 1] Send Input { isAttacking: true } → Server
    ↓ (~50ms network latency)
[Server] Receive input, process combat logic
    ↓
[Server] Hit confirmed! Broadcast AudioEvent::HitImpact
    ↓ (~50ms network latency)
[ALL Clients] Receive AudioEvent::HitImpact
    ↓
[ALL Clients] Play "hit_impact" sound (SYNCHRONIZED)
```

---

## Asset Acquisition

### Free Resources

**Sound Effects**:
- [Freesound.org](https://freesound.org): Search "footstep stone", "sword swing", "jump", "impact"
- [ZapSplat](https://www.zapsplat.com): UI sounds, whooshes, general SFX
- [Sonniss Game Audio GDC Bundles](https://sonniss.com/gameaudiogdc): Free annual bundles (AAA quality)

**Music**:
- [Incompetech](https://incompetech.com/music/royalty-free/music.html) (Kevin MacLeod): Royalty-free music
- [FreePD](https://freepd.com): Public domain music
- [Purple Planet Music](https://www.purple-planet.com): Free background music

**Ambient**:
- [BBC Sound Effects](https://sound-effects.bbcrewind.co.uk): High-quality environmental sounds

### Paid (Optional)

- **AudioJungle**: Combat packs, fantasy SFX (~$10-30 per pack)
- **Pro Sound Effects**: AAA-quality libraries (~$50-200)
- **Epidemic Sound**: Subscription music service (~$15/month)

---

## Testing Checklist

### Phase 1 Acceptance Criteria

- [ ] Footsteps play for all characters based on velocity
- [ ] Walk and run footsteps have different timing
- [ ] Footsteps have 2-3 variations (not repetitive)
- [ ] Footsteps stop when character stops or becomes airborne
- [ ] Jump sound plays on jump start
- [ ] Land sound plays on ground contact
- [ ] Sword swing sounds play on attack state transition
- [ ] Sword swings have 2-3 variations
- [ ] Background music plays and loops correctly
- [ ] Music volume is balanced with SFX
- [ ] Ambient arena sound loops seamlessly
- [ ] Spatial audio positioning works (sound comes from character position)
- [ ] Volume decreases with distance (test at 10, 25, 50+ units)
- [ ] Sounds beyond maxDistance (50 units) don't play
- [ ] Volume controls work (master, SFX, music, ambient)
- [ ] Audio preloading completes before game starts
- [ ] No audio lag or stuttering during gameplay
- [ ] Multiple simultaneous sounds don't cause performance issues

### Phase 2 Acceptance Criteria

- [ ] Hit impact sounds play on server-confirmed hits
- [ ] Heavy hits have different sound than light hits
- [ ] Death sounds play when character health reaches 0
- [ ] Death sound matches character position at death
- [ ] Projectile impact sounds synchronized across clients
- [ ] Player joined notification plays
- [ ] Player left notification plays
- [ ] Predicted local actions have instant audio feedback
- [ ] Server audio events don't double-play with predicted sounds
- [ ] Audio events properly synchronized with visual effects

---

## Performance Metrics

### Target Performance

- **Audio asset size**: < 10MB total (Phase 1)
- **Preload time**: < 2 seconds on fast connection
- **Memory usage**: < 50MB for all loaded sounds
- **CPU overhead**: < 1% during gameplay
- **Concurrent sounds**: 16-32 simultaneous (Babylon.js default)

### Optimization Techniques

1. **Sound pooling**: Reuse Sound instances with variations array
2. **Distance culling**: Don't play sounds beyond `maxDistance`
3. **Lazy loading**: Load music/ambient on-demand (not critical path)
4. **Compressed formats**: Use OGG/MP3 (not WAV)
5. **Mono for spatial sounds**: Stereo only for music/ambient

---

## Known Limitations

### Phase 1

- **Attack sound latency**: Without prediction, own attacks have ~50-100ms delay
  - Mitigated by animation-driven sounds
  - Fully resolved in Phase 2 with predictions

- **Remote character state transitions**: May have slight delay due to snapshot rate (60Hz)
  - Acceptable for Phase 1
  - Not noticeable in practice

### Phase 2

- **Network bandwidth**: Audio events add ~10-20 bytes per event
  - Negligible impact (< 1% increase)
  - Can bundle events with snapshots to reduce packets

---

## Future Enhancements (Post-Phase 2)

- **Dynamic audio ducking**: Lower music volume during combat
- **Reverb zones**: Different audio characteristics per arena area
- **Doppler effect**: For fast-moving projectiles
- **Audio occlusion**: Muffle sounds through walls (raycast-based)
- **Procedural audio**: Generate footstep variations from surface materials
- **Voice chat integration**: Mix in-game audio with voice comms
- **Audio visualization**: Debug mode to visualize sound sources
- **Settings UI**: In-game volume sliders per category

---

## References

- [Babylon.js Sound Documentation](https://doc.babylonjs.com/features/featuresDeepDive/audio/playingSoundsMusic)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Game Audio Best Practices](https://www.gamedeveloper.com/audio/game-audio-best-practices)
- [FMOD Audio System](https://www.fmod.com) (reference architecture)

---

## Changelog

- **2026-02-27**: Initial documentation created (Phase 1 design)
- **TBD**: Phase 1 implementation complete
- **TBD**: Phase 2 design review
- **TBD**: Phase 2 implementation complete
