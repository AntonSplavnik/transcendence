use super::ffi::{CharacterClass, GameStateSnapshot, Vector3D};
use serde::{Deserialize, Serialize};

/// Messages sent FROM server TO client over the game stream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GameServerMessage {
    /// Full game state snapshot (sent at 60 Hz)
    Snapshot(GameStateSnapshot),

    /// Player successfully joined the game
    PlayerJoined {
        player_id: u32,
        name: String,
        character_class: CharacterClass,
    },

    /// Another player left the game
    PlayerLeft { player_id: u32 },

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

    /// Register a hit on another player (client-authoritative for now)
    RegisterHit { victim_id: u32, damage: f32 },

    /// Player is leaving the game
    Leave,
}
