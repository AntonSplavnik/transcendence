use super::ffi::{Game, GameStateSnapshot, Vector3D};
use super::messages::GameServerMessage;
use crate::stream::{Sender, StreamManager};
use futures::SinkExt;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time;
use tracing::{debug, error, info};

pub struct GameManager {
    game: Arc<RwLock<Game>>,
    /// Map of player_id -> stream sender for broadcasting snapshots
    player_streams: Arc<RwLock<HashMap<u32, Sender<GameServerMessage>>>>,
}

impl GameManager {
    pub fn new() -> Self {
        let game = Arc::new(RwLock::new(Game::new()));
        let player_streams = Arc::new(RwLock::new(HashMap::new()));

        Self {
            game,
            player_streams,
        }
    }

    pub async fn start(&self) {
        let mut game = self.game.write().await;
        game.start();
        info!("Game started");
    }

    pub async fn stop(&self) {
        let mut game = self.game.write().await;
        game.stop();
        info!("Game stopped");
    }

    pub async fn is_running(&self) -> bool {
        let game = self.game.read().await;
        game.is_running()
    }

    pub async fn add_player(&self, player_id: u32, name: &str) -> bool {
        let mut game = self.game.write().await;
        let success = game.add_player(player_id, name);
        if success {
            info!("Player {} ({}) joined the game", player_id, name);
        } else {
            error!("Failed to add player {} ({})", player_id, name);
        }
        success
    }

    pub async fn remove_player(&self, player_id: u32) -> bool {
        let mut game = self.game.write().await;
        let success = game.remove_player(player_id);
        if success {
            info!("Player {} left the game", player_id);
        }
        success
    }

    pub async fn get_player_count(&self) -> usize {
        let game = self.game.read().await;
        game.get_player_count()
    }

    pub async fn set_input(
        &self,
        player_id: u32,
        move_dir: Vector3D,
        look_dir: Vector3D,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
        dodging: bool,
    ) {
        let mut game = self.game.write().await;
        game.set_input(
            player_id,
            move_dir,
            look_dir,
            attacking,
            jumping,
            ability1,
            ability2,
            dodging,
        );
    }

    pub async fn get_snapshot(&self) -> GameStateSnapshot {
        let game = self.game.read().await;
        game.get_snapshot()
    }

    pub async fn register_hit(&self, attacker_id: u32, victim_id: u32, damage: f32) {
        let mut game = self.game.write().await;
        game.register_hit(attacker_id, victim_id, damage);
        debug!("Player {} hit player {} for {} damage", attacker_id, victim_id, damage);
    }

    /// Add a player's stream sender for snapshot broadcasting
    pub async fn add_player_stream(&self, player_id: u32, sender: Sender<GameServerMessage>) {
        let mut streams = self.player_streams.write().await;
        streams.insert(player_id, sender);
        info!("Added stream for player {}", player_id);
    }

    /// Remove a player's stream sender
    pub async fn remove_player_stream(&self, player_id: u32) {
        let mut streams = self.player_streams.write().await;
        streams.remove(&player_id);
        info!("Removed stream for player {}", player_id);
    }

    /// Main game loop - runs in background task
    /// Updates physics and broadcasts snapshots to all players
    pub async fn run_game_loop(self: Arc<Self>) {
        info!("Starting game loop");

        let mut physics_interval = time::interval(Duration::from_micros(500));
        let mut snapshot_interval = time::interval(Duration::from_millis(50)); // 20 Hz

        loop {
            tokio::select! {
                // Update physics as fast as possible
                _ = physics_interval.tick() => {
                    let mut game = self.game.write().await;
                    game.update();
                }

                // Broadcast snapshots at 20 Hz
                _ = snapshot_interval.tick() => {
                    let snapshot = {
                        let game = self.game.read().await;
                        game.get_snapshot()
                    };

                    let server_msg = GameServerMessage::Snapshot(snapshot);

                    // Broadcast to all players with active streams
                    let mut streams = self.player_streams.write().await;
                    let mut disconnected = Vec::new();

                    for (player_id, sender) in streams.iter_mut() {
                        if let Err(e) = sender.send(server_msg.clone()).await {
                            error!("Failed to send snapshot to player {}: {}", player_id, e);
                            disconnected.push(*player_id);
                        }
                    }

                    // Remove disconnected players
                    for player_id in disconnected {
                        streams.remove(&player_id);
                        info!("Removed disconnected player {} from streams", player_id);

                        // Also remove from game state
                        let mut game = self.game.write().await;
                        game.remove_player(player_id);
                    }
                }
            }

            // Check if game is still running
            if !self.is_running().await {
                info!("Game loop stopped");
                break;
            }
        }
    }
}
