use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::models::nickname::Nickname;

use super::lobby::LobbySettings;

/// Messages broadcast to all lobby members (players + spectators)
/// over the lobby uni-stream.
#[derive(Debug, Clone, Serialize)]
pub enum LobbyServerMessage {
    PlayerJoined {
        user_id: i32,
        nickname: Nickname,
    },
    PlayerLeft {
        user_id: i32,
    },
    SpectatorJoined {
        user_id: i32,
        nickname: Nickname,
    },
    SpectatorLeft {
        user_id: i32,
    },
    ReadyChanged {
        user_id: i32,
        ready: bool,
    },
    /// UTC timestamp of the planned game start.
    /// Only re-sent when the planned time changes.
    CountdownUpdate {
        start_timestamp: DateTime<Utc>,
    },
    CountdownCancelled,
    GameStarting,
    GameEnded,
    SettingsChanged(LobbySettings),
    LobbyClosed {
        reason: String,
    },
}
