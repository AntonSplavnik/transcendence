use super::ffi::{CharacterClass, GameStateSnapshot, Vector3D};
use serde::{Deserialize, Serialize};

/// Messages sent FROM server TO client over the game stream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GameServerMessage {
    /// Full game state snapshot (sent at 60 Hz)
    Snapshot(GameStateSnapshot),

    /// Another player left the game
    PlayerLeft { player_id: u32 },

    /// A player was killed
    Death { killer: u32, victim: u32 },

    /// A player took damage
    Damage {
        attacker: u32,
        victim: u32,
        damage: f32,
    },

    /// A player spawned or respawned
    Spawn {
        player_id: u32,
        position: Vector3D,
        name: String,
        character_class: CharacterClass,
    },

    /// A player's state changed
    StateChange { player_id: u32, state: u8 },

    /// A player started an attack swing
    AttackStarted { player_id: u32, chain_stage: u8 },

    /// A player activated a skill
    SkillUsed { player_id: u32, skill_slot: u8 },

    /// The match has ended
    MatchEnd,

    /// Error occurred during gameplay
    Error { message: String },
}

/// Messages sent FROM client TO server over the game stream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GameClientMessage {
    /// Player input for the current frame
    Input {
        movement: Vector3D,
        look_direction: Vector3D,
        #[serde(default)]
        attacking: bool,
        #[serde(default)]
        jumping: bool,
        #[serde(default)]
        ability1: bool,
        #[serde(default)]
        ability2: bool,
        #[serde(default)]
        dodging: bool,
        #[serde(default)]
        sprinting: bool,
    },

    /// Player is leaving the game
    Leave,
}
