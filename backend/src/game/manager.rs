use std::sync::Arc;

use ahash::RandomState;
use indexmap::IndexMap;
use parking_lot::Mutex;
use salvo::Depot;
use thiserror::Error;
use tracing::{debug, info, warn};
use ulid::Ulid;

use super::lobby::{Lobby, LobbyInfo, LobbySettings, LobbySettingsPatch};
use super::lobby_messages::LobbyServerMessage;
use super::messages::GameClientMessage;
use crate::models::nickname::Nickname;
use crate::stream::{StreamManager, StreamType};

#[derive(Debug, Error)]
pub enum GameError {
    #[error("already in a lobby")]
    AlreadyInLobby,

    #[error("not in a lobby")]
    NotInLobby,

    #[error("lobby not found")]
    LobbyNotFound,

    #[error("lobby is full")]
    LobbyFull,

    #[error("not a player in this lobby")]
    NotAPlayer,

    #[error("only the lobby host can do this")]
    NotHost,

    #[error("cannot modify settings of a public lobby")]
    SettingsLocked,

    #[error("stream error: {0}")]
    Stream(#[from] anyhow::Error),
}

struct GameManagerState {
    lobbies: IndexMap<Ulid, Arc<Mutex<Lobby>>, RandomState>,
    user_lobby: IndexMap<i32, Ulid, RandomState>,
}

impl GameManagerState {
    fn new() -> Self {
        Self {
            lobbies: IndexMap::default(),
            user_lobby: IndexMap::default(),
        }
    }
}

/// Central manager for all game lobbies.
///
/// Cheaply cloneable (`Arc`-backed). Injected via `affix_state::inject`
/// and retrieved with [`GameManagerDepotExt::game_manager`].
#[derive(Clone)]
pub struct GameManager {
    state: Arc<Mutex<GameManagerState>>,
    sm: Arc<StreamManager>,
}

impl GameManager {
    pub fn new(sm: Arc<StreamManager>) -> Self {
        Self {
            state: Arc::new(Mutex::new(GameManagerState::new())),
            sm,
        }
    }

    /// Create a new lobby and add the host as the first player.
    pub async fn create_lobby(
        &self,
        host_id: i32,
        nickname: Nickname,
        settings: LobbySettings,
    ) -> Result<Ulid, GameError> {
        let lobby_id = Ulid::new();

        // Phase 1: sync — register lobby + prepare player (under lock)
        let (lobby_arc, lobby_streams) = {
            let mut state = self.state.lock();

            if state.user_lobby.contains_key(&host_id) {
                return Err(GameError::AlreadyInLobby);
            }

            let lobby = Lobby::new(lobby_id, host_id, settings);
            let lobby_arc = Arc::new(Mutex::new(lobby));
            state.lobbies.insert(lobby_id, Arc::clone(&lobby_arc));
            state.user_lobby.insert(host_id, lobby_id);

            let lobby_streams = {
                let mut lobby = lobby_arc.lock();
                lobby
                    .prepare_add_player(host_id)
                    .map_err(GameError::Stream)?;
                Arc::clone(lobby.lobby_streams())
            };

            (lobby_arc, lobby_streams)
        };

        // Phase 2: async — open a uni-stream (server→client, no locks held)
        let result = lobby_streams
            .create_uni_stream(host_id, StreamType::Lobby(lobby_id), &self.sm)
            .await;

        if let Err(e) = result {
            let mut state = self.state.lock();
            state.lobbies.swap_remove(&lobby_id);
            state.user_lobby.swap_remove(&host_id);
            return Err(GameError::Stream(e));
        }

        // Phase 3: sync — finalize player addition (under lobby lock)
        {
            let mut lobby = lobby_arc.lock();
            lobby.finish_add_player(host_id, nickname);
        }

        info!(lobby_id = %lobby_id, host_id, "lobby created");
        Ok(lobby_id)
    }

    /// Join an existing lobby as a player.
    pub async fn join_lobby(
        &self,
        lobby_id: Ulid,
        user_id: i32,
        nickname: Nickname,
    ) -> Result<(), GameError> {
        // Phase 1: sync — validate + prepare (under locks)
        let (lobby_arc, lobby_streams) = {
            let mut state = self.state.lock();

            if state.user_lobby.contains_key(&user_id) {
                return Err(GameError::AlreadyInLobby);
            }

            let lobby_arc = state
                .lobbies
                .get(&lobby_id)
                .ok_or(GameError::LobbyNotFound)?
                .clone();

            {
                let mut lobby = lobby_arc.lock();
                if lobby.is_full() {
                    return Err(GameError::LobbyFull);
                }
                lobby
                    .prepare_add_player(user_id)
                    .map_err(GameError::Stream)?;
            }

            state.user_lobby.insert(user_id, lobby_id);
            let lobby_streams = lobby_arc.lock().lobby_streams().clone();
            (lobby_arc, lobby_streams)
        };

        // Phase 2: async — open a uni-stream (server→client, no locks held)
        let result = lobby_streams
            .create_uni_stream(user_id, StreamType::Lobby(lobby_id), &self.sm)
            .await;

        if let Err(e) = result {
            self.state.lock().user_lobby.swap_remove(&user_id);
            return Err(GameError::Stream(e));
        }

        // Phase 3: sync — finalize + evaluate countdown (under lobby lock)
        {
            let mut lobby = lobby_arc.lock();
            lobby.finish_add_player(user_id, nickname);
            let gm = self.clone();
            lobby.evaluate_countdown(move |lid| gm.start_game(lid));
        }

        debug!(lobby_id = %lobby_id, user_id, "player joined lobby");
        Ok(())
    }

    /// Join an existing lobby as a spectator.
    pub async fn spectate_lobby(
        &self,
        lobby_id: Ulid,
        user_id: i32,
        nickname: Nickname,
    ) -> Result<(), GameError> {
        // Phase 1: sync — validate + prepare (under locks)
        let (lobby_arc, lobby_streams) = {
            let mut state = self.state.lock();

            if state.user_lobby.contains_key(&user_id) {
                return Err(GameError::AlreadyInLobby);
            }

            let lobby_arc = state
                .lobbies
                .get(&lobby_id)
                .ok_or(GameError::LobbyNotFound)?
                .clone();

            {
                let mut lobby = lobby_arc.lock();
                lobby
                    .prepare_add_spectator(user_id)
                    .map_err(GameError::Stream)?;
            }

            state.user_lobby.insert(user_id, lobby_id);
            let lobby_streams = lobby_arc.lock().lobby_streams().clone();
            (lobby_arc, lobby_streams)
        };

        // Phase 2: async — open a uni-stream (server→client, no locks held)
        let result = lobby_streams
            .create_uni_stream(user_id, StreamType::Lobby(lobby_id), &self.sm)
            .await;

        if let Err(e) = result {
            self.state.lock().user_lobby.swap_remove(&user_id);
            return Err(GameError::Stream(e));
        }

        // Phase 3: sync — finalize (under lobby lock)
        {
            let mut lobby = lobby_arc.lock();
            lobby.finish_add_spectator(user_id, nickname);
        }

        debug!(lobby_id = %lobby_id, user_id, "spectator joined lobby");
        Ok(())
    }

    /// Leave the current lobby (works for both players and spectators).
    pub fn leave(&self, user_id: i32) -> Result<(), GameError> {
        let (lobby_id, lobby_arc) = {
            let mut state = self.state.lock();

            let lobby_id = state
                .user_lobby
                .swap_remove(&user_id)
                .ok_or_else(|| GameError::NotInLobby)?;

            let lobby_arc = match state.lobbies.get(&lobby_id) {
                Some(l) => l.clone(),
                None => return Ok(()),
            };

            (lobby_id, lobby_arc)
        };

        let should_schedule_cleanup;
        {
            let mut lobby = lobby_arc.lock();

            if lobby.has_player(user_id) {
                lobby.remove_player(user_id);
                // Re-evaluate countdown
                let gm = self.clone();
                lobby.evaluate_countdown(move |lid| gm.start_game(lid));
            } else {
                lobby.remove_spectator(user_id);
            }

            should_schedule_cleanup = lobby.is_empty();
        }

        if should_schedule_cleanup {
            let gm = self.clone();
            let mut lobby = lobby_arc.lock();
            lobby.schedule_cleanup(move |lid| gm.destroy_lobby(lid));
        }

        debug!(lobby_id = %lobby_id, user_id, "user left lobby");
        Ok(())
    }

    pub fn set_ready(&self, user_id: i32, ready: bool) -> Result<(), GameError> {
        let lobby_arc = self.get_user_lobby_arc(user_id)?;
        let mut lobby = lobby_arc.lock();
        if !lobby.set_ready(user_id, ready) {
            return Err(GameError::NotAPlayer);
        }

        let gm = self.clone();
        lobby.evaluate_countdown(move |lid| gm.start_game(lid));
        Ok(())
    }

    pub fn update_settings(
        &self,
        user_id: i32,
        patch: LobbySettingsPatch,
    ) -> Result<(), GameError> {
        let lobby_arc = self.get_user_lobby_arc(user_id)?;
        let mut lobby = lobby_arc.lock();
        if lobby.host_id() != user_id {
            return Err(GameError::NotHost);
        }
        if !lobby.update_settings(patch) {
            return Err(GameError::SettingsLocked);
        }
        Ok(())
    }

    pub fn get_lobby_info(&self, lobby_id: Ulid) -> Option<LobbyInfo> {
        let state = self.state.lock();
        let lobby_arc = state.lobbies.get(&lobby_id)?;
        let lobby = lobby_arc.lock();
        Some(lobby.info())
    }

    pub fn list_public_lobbies(&self) -> Vec<LobbyInfo> {
        let state = self.state.lock();
        state
            .lobbies
            .values()
            .filter_map(|lobby_arc| {
                let lobby = lobby_arc.lock();
                if lobby.settings().public {
                    Some(lobby.info())
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn user_lobby(&self, user_id: i32) -> Option<Ulid> {
        self.state.lock().user_lobby.get(&user_id).copied()
    }

    /// Called synchronously when the countdown finishes.
    /// Spawns an async task that opens all streams and starts the game.
    fn start_game(&self, lobby_id: Ulid) {
        let gm = self.clone();
        tokio::spawn(async move {
            gm.start_game_async(lobby_id).await;
        });
    }

    /// Opens game streams for all players and spectators, connects players to
    /// the C++ engine, and spawns the game loop thread.
    async fn start_game_async(&self, lobby_id: Ulid) {
        let lobby_arc = {
            let state = self.state.lock();
            match state.lobbies.get(&lobby_id) {
                Some(l) => l.clone(),
                None => return,
            }
        };

        // Phase 1: sync — validate, collect membership, mark game active.
        let (game, players, spectators, game_streams);
        {
            let mut lobby = lobby_arc.lock();

            // Guard: race with another start_game call (e.g. double-fire of countdown timer)
            if lobby.is_game_active() {
                debug!(lobby_id = %lobby_id, "start_game_async: game already active, skipping");
                return;
            }

            players = lobby.player_nicknames().collect::<Vec<_>>();

            // Guard: players may have left in the race window between the countdown
            // timer firing and this task acquiring the lobby lock.
            if players.len() < lobby.game().min_players() as usize {
                warn!(
                    lobby_id = %lobby_id,
                    players = players.len(),
                    "countdown fired but not enough players remain, aborting game start"
                );
                lobby.abort_countdown();
                return;
            }

            spectators = lobby.spectator_ids().collect::<Vec<_>>();
            game = Arc::clone(lobby.game());
            lobby.start_game_session();
            lobby
                .lobby_streams()
                .broadcast(&LobbyServerMessage::GameStarting);
            game_streams = Arc::clone(lobby.game_streams());
        }

        // Phase 2: async — open bidi game streams for players (no locks held).
        // Each stream gets a receive loop that feeds client input into the engine.
        for (uid, _nick) in &players {
            let uid = *uid;
            let game_ref = Arc::clone(&game);
            let gm = self.clone();
            let result = game_streams
                .create_stream::<GameClientMessage>(
                    uid,
                    StreamType::Game,
                    &self.sm,
                    move |user_id, msg| {
                        let keep = game_ref.on_client_msg(user_id as u32, msg);
                        if !keep {
                            // Player sent Leave — remove from lobby
                            let _ = gm.leave(user_id);
                        }
                        keep
                    },
                )
                .await;

            if let Err(e) = result {
                warn!(lobby_id = %lobby_id, user_id = uid, error = %e,
                    "failed to open game stream for player");
            }
        }

        // Phase 3: async — open uni-directional game streams for spectators.
        for uid in &spectators {
            let uid = *uid;
            let result = game_streams
                .create_uni_stream(uid, StreamType::Game, &self.sm)
                .await;

            if let Err(e) = result {
                warn!(lobby_id = %lobby_id, user_id = uid, error = %e,
                    "failed to open game stream for spectator");
            }
        }

        // Phase 4: sync — connect players to the C++ engine.
        // Done after stream setup so the engine and streams are ready together.
        for (uid, nick) in &players {
            game.on_connect(*uid as u32, nick.as_ref());
        }

        let lobby_weak = Arc::downgrade(&lobby_arc);
        let game_for_loop = Arc::clone(&game);
        let gm_cleanup = self.clone();

        std::thread::Builder::new()
            .name(format!("game-{lobby_id}"))
            .spawn(move || {
                // `gs` is the last Arc clone of the old game_streams; when this
                // thread exits gs is dropped, refcount → 0, and StreamGroup::Drop
                // cancels all handle tokens, stopping every receive task cleanly.
                let gs = game_streams;
                game_for_loop.update_loop(
                    |msg| gs.broadcast(&msg),
                    |player_id, msg| gs.send(player_id as i32, &msg),
                );

                // Game loop ended — clear state and schedule lobby cleanup if empty.
                if let Some(lobby_arc) = lobby_weak.upgrade() {
                    let mut lobby = lobby_arc.lock();
                    // Replaces lobby.game_streams with a fresh group, so old Arc
                    // refcount goes 2 → 1 (only gs still holds it above).
                    lobby.clear_game();

                    if lobby.is_empty() {
                        let gm = gm_cleanup;
                        lobby.schedule_cleanup(move |lid| gm.destroy_lobby(lid));
                    }
                }
                // gs drops here → old StreamGroup dropped → all handles cancelled
            })
            .expect("failed to spawn game thread");

        info!(lobby_id = %lobby_id, players = players.len(), "game started");
    }

    /// Destroy a lobby after the cleanup timer fires.
    fn destroy_lobby(&self, lobby_id: Ulid) {
        let mut state = self.state.lock();

        let Some(lobby_arc) = state.lobbies.swap_remove(&lobby_id) else {
            return;
        };

        let lobby = lobby_arc.lock();

        // Only destroy if truly empty — someone may have joined in the meantime
        if !lobby.is_empty() {
            // Put it back
            drop(lobby);
            state.lobbies.insert(lobby_id, lobby_arc);
            return;
        }

        // Remove any lingering user→lobby mappings
        state.user_lobby.retain(|_, lid| *lid != lobby_id);

        // Drop the lock before closing (close broadcasts, which is fine)
        drop(lobby);
        lobby_arc.lock().close("lobby expired");

        info!(lobby_id = %lobby_id, "lobby destroyed (empty timeout)");
    }

    fn get_user_lobby_arc(&self, user_id: i32) -> Result<Arc<Mutex<Lobby>>, GameError> {
        let state = self.state.lock();
        let lobby_id = state
            .user_lobby
            .get(&user_id)
            .ok_or_else(|| GameError::NotInLobby)?;
        state
            .lobbies
            .get(lobby_id)
            .cloned()
            .ok_or(GameError::LobbyNotFound)
    }
}

pub trait GameManagerDepotExt {
    fn game_manager(&self) -> &GameManager;
}

impl GameManagerDepotExt for Depot {
    fn game_manager(&self) -> &GameManager {
        self.obtain::<GameManager>()
            .expect("GameManager not found in depot")
    }
}
