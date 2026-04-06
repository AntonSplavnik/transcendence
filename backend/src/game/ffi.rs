// CXX bridge to C++ game engine
// Replaces the old hand-written C FFI with type-safe CXX bindings.

use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};

#[cxx::bridge(namespace = "arena_game")]
mod bridge {
    #[repr(u8)]
    enum GameModeType {
        Deathmatch = 0,
        LastStanding = 1,
        WaveSurvival = 2,
        TeamDeathmatch = 3,
    }

    #[repr(u8)]
    enum NetworkEventType {
        Death = 1,
        Damage = 2,
        Spawn = 3,
        StateChange = 4,
        MatchEnd = 5,
    }

    struct Vec3 {
        x: f32,
        y: f32,
        z: f32,
    }

    struct PlayerInput {
        movement: Vec3,
        look_direction: Vec3,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
        dodging: bool,
        sprinting: bool,
    }

    struct CharacterSnapshot {
        player_id: u32,
        position: Vec3,
        velocity: Vec3,
        yaw: f32,
        state: u8,
        health: f32,
        max_health: f32,
        ability1_timer: f32,
        ability1_cooldown: f32,
        ability2_timer: f32,
        ability2_cooldown: f32,
        swing_progress: f32,
    }

    struct GameStateSnapshot {
        frame_number: u64,
        timestamp: f64,
        characters: Vec<CharacterSnapshot>,
    }

    struct DeathEvent {
        killer: u32,
        victim: u32,
    }

    struct DamageEvent {
        attacker: u32,
        victim: u32,
        damage: f32,
    }

    struct SpawnEvent {
        player_id: u32,
        position: Vec3,
    }

    struct StateChangeEvent {
        player_id: u32,
        state: u8,
    }

    unsafe extern "C++" {
        include!("cxx_bridge.hpp");

        type GameBridge;

        fn create_bridge() -> UniquePtr<GameBridge>;
        fn start(self: Pin<&mut GameBridge>, mode: GameModeType);
        fn stop(self: Pin<&mut GameBridge>);
        fn update(self: Pin<&mut GameBridge>);
        fn is_running(self: &GameBridge) -> bool;
        fn get_player_count(self: &GameBridge) -> usize;

        fn add_player(self: Pin<&mut GameBridge>, id: u32, name: &str) -> bool;
        fn remove_player(self: Pin<&mut GameBridge>, id: u32) -> bool;
        fn set_player_input(self: Pin<&mut GameBridge>, id: u32, input: &PlayerInput);

        fn get_snapshot(self: &GameBridge) -> GameStateSnapshot;

        type EventQueue;

        fn len(self: &EventQueue) -> usize;
        fn kind_at(self: &EventQueue, idx: usize) -> NetworkEventType;
        fn get_death_at(self: &EventQueue, idx: usize) -> DeathEvent;
        fn get_damage_at(self: &EventQueue, idx: usize) -> DamageEvent;
        fn get_spawn_at(self: &EventQueue, idx: usize) -> SpawnEvent;
        fn get_state_change_at(self: &EventQueue, idx: usize) -> StateChangeEvent;

        fn take_events(self: Pin<&mut GameBridge>) -> UniquePtr<EventQueue>;
    }
}

// SAFETY: GameBridge is only accessed through a Mutex, ensuring exclusive
// access. The raw C++ object is never aliased across threads.
unsafe impl Send for bridge::GameBridge {}

pub use bridge::GameModeType;

// =============================================================================
// Rust types with serde support (for network serialization)
// =============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub enum CharacterClass {
    #[default]
    Knight,
    Rogue,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub struct Vector3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Default for Vector3D {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CharacterSnapshot {
    pub player_id: u32,
    pub position: Vector3D,
    pub velocity: Vector3D,
    pub yaw: f32,
    pub state: u8,
    pub health: f32,
    pub max_health: f32,
    pub ability1_timer: f32,
    pub ability1_cooldown: f32,
    pub ability2_timer: f32,
    pub ability2_cooldown: f32,
    pub swing_progress: f32,
}

impl From<bridge::CharacterSnapshot> for CharacterSnapshot {
    fn from(c: bridge::CharacterSnapshot) -> Self {
        Self {
            player_id: c.player_id,
            position: Vector3D {
                x: c.position.x,
                y: c.position.y,
                z: c.position.z,
            },
            velocity: Vector3D {
                x: c.velocity.x,
                y: c.velocity.y,
                z: c.velocity.z,
            },
            yaw: c.yaw,
            state: c.state,
            health: c.health,
            max_health: c.max_health,
            ability1_timer: c.ability1_timer,
            ability1_cooldown: c.ability1_cooldown,
            ability2_timer: c.ability2_timer,
            ability2_cooldown: c.ability2_cooldown,
            swing_progress: c.swing_progress,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GameStateSnapshot {
    pub frame_number: u64,
    pub timestamp: f64,
    pub characters: Vec<CharacterSnapshot>,
}

impl From<bridge::GameStateSnapshot> for GameStateSnapshot {
    fn from(snap: bridge::GameStateSnapshot) -> Self {
        Self {
            frame_number: snap.frame_number,
            timestamp: snap.timestamp,
            characters: snap.characters.into_iter().map(Into::into).collect(),
        }
    }
}

// =============================================================================
// Network Events
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NetworkEvent {
    Death {
        killer: u32,
        victim: u32,
    },
    Damage {
        attacker: u32,
        victim: u32,
        damage: f32,
    },
    Spawn {
        player_id: u32,
        position: Vector3D,
    },
    StateChange {
        player_id: u32,
        state: u8,
    },
    MatchEnd,
}

// =============================================================================
// Helper functions
// =============================================================================

pub fn parse_game_mode(name: &str) -> Option<GameModeType> {
    match name.to_lowercase().as_str() {
        "deathmatch" | "ffa" | "free_for_all" => Some(GameModeType::Deathmatch),
        "last_standing" | "laststanding" => Some(GameModeType::LastStanding),
        "wave_survival" | "wavesurvival" => Some(GameModeType::WaveSurvival),
        "team_deathmatch" | "teamdeathmatch" | "tdm" => Some(GameModeType::TeamDeathmatch),
        _ => None,
    }
}

pub fn mode_type_name(mode: GameModeType) -> &'static str {
    match mode {
        GameModeType::Deathmatch => "Deathmatch",
        GameModeType::LastStanding => "Last Standing",
        GameModeType::WaveSurvival => "Wave Survival",
        GameModeType::TeamDeathmatch => "Team Deathmatch",
        _ => "Unknown",
    }
}

// =============================================================================
// GameHandle — safe wrapper around CXX UniquePtr<GameBridge>
// =============================================================================

pub struct GameHandle {
    engine: cxx::UniquePtr<bridge::GameBridge>,
}

impl GameHandle {
    pub(super) fn new() -> Self {
        Self {
            engine: bridge::create_bridge(),
        }
    }

    pub fn start(&mut self, mode: GameModeType) {
        self.engine.pin_mut().start(mode);
    }

    pub fn stop(&mut self) {
        self.engine.pin_mut().stop();
    }

    pub fn update(&mut self) {
        self.engine.pin_mut().update();
    }

    pub fn is_running(&self) -> bool {
        self.engine.is_running()
    }

    pub fn get_player_count(&self) -> usize {
        self.engine.get_player_count()
    }

    pub fn add_player(&mut self, player_id: u32, name: &str) -> bool {
        self.engine.pin_mut().add_player(player_id, name)
    }

    pub fn remove_player(&mut self, player_id: u32) -> bool {
        self.engine.pin_mut().remove_player(player_id)
    }

    pub fn set_input(
        &mut self,
        player_id: u32,
        move_dir: Vector3D,
        look_dir: Vector3D,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
        dodging: bool,
        sprinting: bool,
    ) {
        let input = bridge::PlayerInput {
            movement: bridge::Vec3 {
                x: move_dir.x,
                y: move_dir.y,
                z: move_dir.z,
            },
            look_direction: bridge::Vec3 {
                x: look_dir.x,
                y: look_dir.y,
                z: look_dir.z,
            },
            attacking,
            jumping,
            ability1,
            ability2,
            dodging,
            sprinting,
        };
        self.engine.pin_mut().set_player_input(player_id, &input);
    }

    pub fn get_snapshot(&self) -> GameStateSnapshot {
        self.engine.get_snapshot().into()
    }

    pub fn drain_network_events(&mut self) -> Vec<NetworkEvent> {
        let queue = self.engine.pin_mut().take_events();
        (0..queue.len())
            .map(|i| match queue.kind_at(i) {
                bridge::NetworkEventType::Death => {
                    let e = queue.get_death_at(i);
                    NetworkEvent::Death { killer: e.killer, victim: e.victim }
                }
                bridge::NetworkEventType::Damage => {
                    let e = queue.get_damage_at(i);
                    NetworkEvent::Damage { attacker: e.attacker, victim: e.victim, damage: e.damage }
                }
                bridge::NetworkEventType::Spawn => {
                    let e = queue.get_spawn_at(i);
                    NetworkEvent::Spawn {
                        player_id: e.player_id,
                        position: Vector3D { x: e.position.x, y: e.position.y, z: e.position.z },
                    }
                }
                bridge::NetworkEventType::StateChange => {
                    let e = queue.get_state_change_at(i);
                    NetworkEvent::StateChange { player_id: e.player_id, state: e.state }
                }
                bridge::NetworkEventType::MatchEnd => NetworkEvent::MatchEnd,
                _ => unreachable!(),
            })
            .collect()
    }

    /// Minimum number of players required to start a game.
    pub fn min_players(&self) -> u32 {
        2
    }

    /// Maximum number of players allowed in a game.
    pub fn max_players(&self) -> u32 {
        8
    }
}
