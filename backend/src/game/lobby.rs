use std::sync::Arc;
use std::time::Duration;

use ahash::RandomState;
use chrono::Utc;
use indexmap::{IndexMap, IndexSet};
use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;
use tokio::task::JoinHandle;
use ulid::Ulid;

use tracing::debug;

use super::game::Game;
use super::lobby_messages::LobbyServerMessage;
use super::messages::GameServerMessage;
use crate::models::nickname::Nickname;
use crate::stream::StreamGroup;

const COUNTDOWN_DEFAULT: Duration = Duration::from_secs(60);
const COUNTDOWN_ALL_READY: Duration = Duration::from_secs(3);
const COUNTDOWN_FULL: Duration = Duration::from_secs(10);
const CLEANUP_DELAY: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LobbySettings {
    pub name: String,
    pub public: bool,
    pub gamemode: String,
}

/// Partial update for lobby settings. Only provided fields are changed.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct LobbySettingsPatch {
    pub name: Option<String>,
    pub public: Option<bool>,
    pub gamemode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlayerState {
    pub ready: bool,
    pub nickname: Nickname,
}

pub enum CountdownState {
    Idle,
    Running {
        start_at: std::time::Instant,
        task: JoinHandle<()>,
    },
    Finished,
}

impl CountdownState {
    fn abort(&mut self) {
        if let CountdownState::Running { task, .. } = self {
            task.abort();
        }
        *self = CountdownState::Idle;
    }
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LobbyInfo {
    pub id: Ulid,
    /// The user ID of the lobby host.
    pub host_id: i32,
    pub settings: LobbySettings,
    pub player_count: usize,
    pub spectator_count: usize,
    pub players: Vec<LobbyPlayerInfo>,
    pub game_active: bool,
    pub countdown_start_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LobbyPlayerInfo {
    pub user_id: i32,
    pub nickname: Nickname,
    pub ready: bool,
}

pub struct Lobby {
    pub id: Ulid,
    settings: LobbySettings,
    host_id: i32,
    players: IndexMap<i32, PlayerState, RandomState>,
    /// Spectators receive lobby-stream broadcasts (join/leave/countdown events)
    /// and, once a game starts, all broadcast game-stream packets.
    /// They cannot send game input or set ready state.
    spectators: IndexSet<i32, RandomState>,
    lobby_streams: Arc<StreamGroup<LobbyServerMessage>>,
    game_streams: Arc<StreamGroup<GameServerMessage>>,
    /// The game handle for this lobby. Created at lobby creation with the
    /// configured gamemode. Replaced with a fresh handle after each match ends
    /// so the engine state is clean for the next game.
    game: Arc<Game>,
    /// Whether a game loop is currently running.
    game_active: bool,
    countdown: CountdownState,
    cleanup_handle: Option<JoinHandle<()>>,
}

impl Lobby {
    pub fn new(id: Ulid, host_id: i32, settings: LobbySettings) -> Self {
        let game = Arc::new(Game::new(&settings.gamemode));
        Self {
            id,
            settings,
            host_id,
            players: IndexMap::default(),
            spectators: IndexSet::default(),
            lobby_streams: Arc::new(StreamGroup::default()),
            game_streams: Arc::new(StreamGroup::default()),
            game,
            game_active: false,
            countdown: CountdownState::Idle,
            cleanup_handle: None,
        }
    }

    // ── Queries ──────────────────────────────────────────────────────────

    pub fn host_id(&self) -> i32 {
        self.host_id
    }

    pub fn is_full(&self) -> bool {
        self.players.len() >= self.game.max_players() as usize
    }

    pub fn is_empty(&self) -> bool {
        self.players.is_empty() && self.spectators.is_empty()
    }

    pub fn has_player(&self, user_id: i32) -> bool {
        self.players.contains_key(&user_id)
    }

    pub fn has_spectator(&self, user_id: i32) -> bool {
        self.spectators.contains(&user_id)
    }

    pub fn has_member(&self, user_id: i32) -> bool {
        self.has_player(user_id) || self.has_spectator(user_id)
    }

    pub fn settings(&self) -> &LobbySettings {
        &self.settings
    }

    /// The game handle for this lobby. Always present; use [`is_game_active`]
    /// to check whether the game loop is currently running.
    pub fn game(&self) -> &Arc<Game> {
        &self.game
    }

    /// Whether a game loop is currently running for this lobby.
    pub fn is_game_active(&self) -> bool {
        self.game_active
    }

    pub fn game_streams(&self) -> &Arc<StreamGroup<GameServerMessage>> {
        &self.game_streams
    }

    pub fn lobby_streams(&self) -> &Arc<StreamGroup<LobbyServerMessage>> {
        &self.lobby_streams
    }

    /// Build the lobby info DTO.
    pub fn info(&self) -> LobbyInfo {
        let countdown_start_at = match &self.countdown {
            CountdownState::Running { start_at, .. } => {
                let remaining = start_at.saturating_duration_since(std::time::Instant::now());
                Some(Utc::now() + remaining)
            }
            _ => None,
        };

        LobbyInfo {
            id: self.id,
            host_id: self.host_id,
            settings: self.settings.clone(),
            player_count: self.players.len(),
            spectator_count: self.spectators.len(),
            players: self
                .players
                .iter()
                .map(|(&user_id, state)| LobbyPlayerInfo {
                    user_id,
                    nickname: state.nickname.clone(),
                    ready: state.ready,
                })
                .collect(),
            game_active: self.game_active,
            countdown_start_at,
        }
    }

    // ── Mutations (caller holds the Mutex) ───────────────────────────────

    /// Pre-check and register intent to add a player. Returns streams needed
    /// for the async stream-creation step.
    ///
    /// Call [`finish_add_player`] after the async stream creation succeeds.
    pub fn prepare_add_player(&mut self, user_id: i32) -> Result<(), anyhow::Error> {
        if self.is_full() {
            anyhow::bail!("lobby is full");
        }
        if self.has_member(user_id) {
            anyhow::bail!("user already in lobby");
        }

        // Cancel any pending cleanup
        if let Some(handle) = self.cleanup_handle.take() {
            handle.abort();
        }

        Ok(())
    }

    /// Finalize adding a player after the lobby stream has been opened.
    pub fn finish_add_player(&mut self, user_id: i32, nickname: Nickname) {
        self.players.insert(
            user_id,
            PlayerState {
                ready: false,
                nickname: nickname.clone(),
            },
        );

        self.lobby_streams
            .broadcast(&LobbyServerMessage::PlayerJoined { user_id, nickname });
    }

    /// Remove a player from the lobby.
    pub fn remove_player(&mut self, user_id: i32) {
        if self.players.swap_remove(&user_id).is_none() {
            return;
        }
        self.lobby_streams.destroy_handle(user_id);
        self.game_streams.destroy_handle(user_id);

        if self.game_active {
            self.game.on_disconnect(user_id as u32);
        }

        self.lobby_streams
            .broadcast(&LobbyServerMessage::PlayerLeft { user_id });
    }

    /// Pre-check and register intent to add a spectator.
    ///
    /// Call [`finish_add_spectator`] after the async stream creation succeeds.
    pub fn prepare_add_spectator(&mut self, user_id: i32) -> Result<(), anyhow::Error> {
        if self.has_member(user_id) {
            anyhow::bail!("user already in lobby");
        }

        // Cancel any pending cleanup
        if let Some(handle) = self.cleanup_handle.take() {
            handle.abort();
        }

        Ok(())
    }

    /// Finalize adding a spectator after the lobby stream has been opened.
    pub fn finish_add_spectator(&mut self, user_id: i32, nickname: Nickname) {
        self.spectators.insert(user_id);

        self.lobby_streams
            .broadcast(&LobbyServerMessage::SpectatorJoined { user_id, nickname });
    }

    /// Remove a spectator from the lobby.
    pub fn remove_spectator(&mut self, user_id: i32) {
        if !self.spectators.swap_remove(&user_id) {
            return;
        }
        self.lobby_streams.destroy_handle(user_id);
        self.game_streams.destroy_handle(user_id);

        self.lobby_streams
            .broadcast(&LobbyServerMessage::SpectatorLeft { user_id });
    }

    /// Toggle ready state for a player. Returns `false` if `user_id` is not a player.
    pub fn set_ready(&mut self, user_id: i32, ready: bool) -> bool {
        let Some(state) = self.players.get_mut(&user_id) else {
            return false;
        };
        state.ready = ready;
        self.lobby_streams
            .broadcast(&LobbyServerMessage::ReadyChanged { user_id, ready });
        true
    }

    /// Apply a partial settings update. Only allowed while the lobby is still private.
    /// Returns `false` if the lobby is already public (settings are locked).
    pub fn update_settings(&mut self, patch: LobbySettingsPatch) -> bool {
        if self.settings.public {
            return false;
        }
        if let Some(name) = patch.name {
            self.settings.name = name;
        }
        if let Some(public) = patch.public {
            self.settings.public = public;
        }
        if let Some(gamemode) = patch.gamemode {
            self.settings.gamemode = gamemode;
        }
        self.lobby_streams
            .broadcast(&LobbyServerMessage::SettingsChanged(self.settings.clone()));
        true
    }

    /// Re-evaluate the countdown based on current lobby state.
    ///
    /// Must be called after any change that affects player count or readiness.
    /// `start_game_fn` is called when the countdown fires — it should call
    /// `GameManager::start_game`.
    pub fn evaluate_countdown(&mut self, start_game_fn: impl FnOnce(Ulid) + Send + 'static) {
        let player_count = self.players.len();
        let ready_count = self.players.values().filter(|p| p.ready).count();

        // Countdown only starts when at least half the players (ceiling, min 2) are ready
        // AND there are enough players for the game.
        let ready_threshold = std::cmp::max(2, player_count.div_ceil(2));
        let can_start =
            player_count >= self.game.min_players() as usize && ready_count >= ready_threshold;

        if !can_start {
            if matches!(self.countdown, CountdownState::Running { .. }) {
                self.countdown.abort();
                self.lobby_streams
                    .broadcast(&LobbyServerMessage::CountdownCancelled);
            }
            return;
        }

        // Determine target deadline
        let target_duration = if self.is_full() {
            COUNTDOWN_FULL
        } else if self.players.values().all(|p| p.ready) {
            COUNTDOWN_ALL_READY
        } else {
            COUNTDOWN_DEFAULT
        };

        let target_start_at = std::time::Instant::now() + target_duration;

        match &self.countdown {
            CountdownState::Running { start_at, .. } => {
                // Only lower — never raise the deadline
                if target_start_at >= *start_at {
                    return;
                }
            }
            CountdownState::Idle => { /* start a new countdown */ }
            CountdownState::Finished => return,
        }

        // Abort any running countdown
        self.countdown.abort();

        let lobby_id = self.id;
        let task = tokio::spawn(async move {
            tokio::time::sleep(target_duration).await;
            start_game_fn(lobby_id);
        });

        self.countdown = CountdownState::Running {
            start_at: target_start_at,
            task,
        };

        // Broadcast the new planned start timestamp
        let start_timestamp = Utc::now() + target_duration;

        self.lobby_streams
            .broadcast(&LobbyServerMessage::CountdownUpdate { start_timestamp });
    }

    /// Mark the game as active when the countdown finishes.
    ///
    /// The game handle was already created at lobby construction (or reset by
    /// `clear_game` after the previous match). Callers should clone the handle
    /// via `game()` before calling this to use it in the game loop.
    pub fn start_game_session(&mut self) {
        self.game_active = true;
        self.countdown = CountdownState::Finished;
    }

    /// Reset a stale countdown to Idle.
    ///
    /// Called when the countdown timer fires but the game cannot start (e.g.
    /// too few players remain). Without this, `evaluate_countdown` would see
    /// `Running { start_at: <past> }` and never start a fresh countdown.
    pub fn abort_countdown(&mut self) {
        debug!(lobby_id = %self.id, "resetting stale countdown to Idle");
        self.countdown.abort();
    }

    /// Clear the game instance when the game ends.
    ///
    /// Replaces `game_streams` with a fresh group so the old group's Arc
    /// refcount drops to 1 (held only by the game thread). When the thread
    /// exits and drops its clone the count hits 0, `Drop` fires, and every
    /// handle's cancellation token is cancelled — cleanly stopping all
    /// receive tasks.
    pub fn clear_game(&mut self) {
        debug!(
            lobby_id = %self.id,
            players = self.players.len(),
            spectators = self.spectators.len(),
            "clearing game state; replacing game_streams Arc to trigger handle cleanup"
        );
        self.game_active = false;
        self.countdown = CountdownState::Idle;
        // Fresh game handle so the next match starts with clean engine state.
        self.game = Arc::new(Game::new(&self.settings.gamemode));
        // The old game_streams Arc refcount drops from 2 → 1 here.
        // The game thread holds the last reference via `gs`; when that
        // thread exits, refcount → 0 and StreamGroup::Drop cancels all tokens.
        self.game_streams = Arc::new(StreamGroup::default());
        self.lobby_streams.broadcast(&LobbyServerMessage::GameEnded);

        // Reset all players' ready state so they can queue up again
        for state in self.players.values_mut() {
            state.ready = false;
        }
    }

    /// Start a cleanup timer. If no one joins before it fires, the lobby
    /// should be destroyed.
    ///
    /// Requires a `Handle` so this can be called from non-Tokio threads (e.g.
    /// the game loop thread which runs on a plain `std::thread`).
    pub fn schedule_cleanup(
        &mut self,
        rt: &Handle,
        cleanup_fn: impl FnOnce(Ulid) + Send + 'static,
    ) {
        if let Some(handle) = self.cleanup_handle.take() {
            handle.abort();
        }
        debug!(lobby_id = %self.id, delay_secs = CLEANUP_DELAY.as_secs(),
            "scheduling lobby cleanup");
        let lobby_id = self.id;
        self.cleanup_handle = Some(rt.spawn(async move {
            tokio::time::sleep(CLEANUP_DELAY).await;
            cleanup_fn(lobby_id);
        }));
    }

    /// Broadcast a close message and abort all pending tasks.
    ///
    /// Does not explicitly cancel stream handles — those are cleaned up when
    /// the `StreamGroup` Arcs are dropped (either immediately if this is the
    /// last owner, or when the game thread exits for `game_streams`).
    pub fn close(&mut self, reason: &str) {
        debug!(lobby_id = %self.id, reason, "closing lobby");
        self.countdown.abort();
        if let Some(handle) = self.cleanup_handle.take() {
            handle.abort();
        }
        self.lobby_streams
            .broadcast(&LobbyServerMessage::LobbyClosed {
                reason: reason.to_owned(),
            });
    }

    /// Returns `(user_id, nickname)` pairs for all players.
    pub fn player_nicknames(&self) -> impl Iterator<Item = (i32, Nickname)> + '_ {
        self.players
            .iter()
            .map(|(&uid, state)| (uid, state.nickname.clone()))
    }

    /// Returns the spectator user IDs.
    pub fn spectator_ids(&self) -> impl Iterator<Item = i32> + '_ {
        self.spectators.iter().copied()
    }
}
