use parking_lot::{Mutex, MutexGuard};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::info;

use super::ffi::{CharacterClass, GameHandle, GameMode, NetworkEvent};
use super::messages::{GameClientMessage, GameServerMessage};

/// Thread-safe high-level wrapper around the C++ game engine.
/// Owns a Mutex<GameHandle>, so it is Send + Sync via the mutex.
/// Networking-agnostic; exposes on_connect / on_disconnect hooks.
pub struct Game {
    handle: Mutex<GameHandle>,
    mode: GameMode,
    /// Maps player_id → (name, character_class). Used to enrich Spawn events.
    player_info: Mutex<HashMap<u32, (String, CharacterClass)>>,
}

impl Game {
    pub fn new(mode: GameMode) -> Self {
        Self {
            handle: Mutex::new(GameHandle::new()),
            mode,
            player_info: Mutex::new(HashMap::new()),
        }
    }

    /// Provides exclusive access to the underlying GameHandle.
    pub fn lock(&self) -> MutexGuard<'_, GameHandle> {
        self.handle.lock()
    }

    pub fn min_players(&self) -> u32 {
        self.handle.lock().min_players()
    }

    pub fn max_players(&self) -> u32 {
        self.handle.lock().max_players()
    }

    /// Called when a player connects to the game.
    /// Game does not know about networking — this is just a hook for external code.
    pub fn on_connect(&self, player_id: u32, name: &str, character_class: CharacterClass) -> bool {
        self.player_info
            .lock()
            .insert(player_id, (name.to_string(), character_class.clone()));
        self.handle.lock().add_player(player_id, name, character_class.as_str())
    }

    /// Called when a player disconnects from the game.
    /// Game does not know about networking — this is just a hook for external code.
    pub fn on_disconnect(&self, player_id: u32) -> bool {
        self.player_info.lock().remove(&player_id);
        self.handle.lock().remove_player(player_id)
    }

    /// Process an incoming client message for a given player.
    /// Returns `false` if the player wants to leave (caller should disconnect them).
    pub fn on_client_msg(&self, player_id: u32, msg: GameClientMessage) -> bool {
        match msg {
            GameClientMessage::Input {
                movement,
                look_direction,
                attacking,
                jumping,
                ability1,
                ability2,
                dodging,
                sprinting,
            } => {
                self.lock().set_input(
                    player_id,
                    movement,
                    look_direction,
                    attacking,
                    jumping,
                    ability1,
                    ability2,
                    dodging,
                    sprinting,
                );
                true
            }
            GameClientMessage::Leave => false,
        }
    }

    /// Synchronous game loop — blocks the calling thread.
    ///
    /// Updates physics every tick and broadcasts snapshots at ~60 Hz.
    /// The caller is responsible for running this on a dedicated thread.
    pub fn update_loop(
        &self,
        broadcast: impl Fn(Arc<GameServerMessage>),
        _send: impl Fn(u32, Arc<GameServerMessage>),
    ) {
        const TICK_DURATION: Duration = Duration::from_micros(1_000_000 / 60); // ~60 Hz (16_667 µs)

        info!("Game loop started (mode: {:?})", self.mode);
        self.lock().start(self.mode);

        loop {
            let tick_start = Instant::now();

            let (snapshot, events) = {
                let mut handle = self.lock();

                if !handle.is_running() || handle.get_player_count() == 0 {
                    info!("Game loop stopped");
                    break;
                }

                handle.update();
                let snapshot = handle.get_snapshot();
                let events = handle.drain_network_events();
                (snapshot, events)
            };

            for event in events {
                let msg = Arc::new(match event {
                    NetworkEvent::Death { killer, victim } => {
                        GameServerMessage::Death { killer, victim }
                    }
                    NetworkEvent::Damage {
                        attacker,
                        victim,
                        damage,
                    } => GameServerMessage::Damage {
                        attacker,
                        victim,
                        damage,
                    },
                    NetworkEvent::Spawn {
                        player_id,
                        position,
                        character_class,
                    } => {
                        let name = self.player_info.lock()
                            .get(&player_id)
                            .map(|(n, _)| n.clone())
                            .unwrap_or_default();
                        GameServerMessage::Spawn {
                            player_id,
                            position,
                            name,
                            character_class: CharacterClass::from(character_class.as_str()),
                        }
                    }
                    NetworkEvent::StateChange { player_id, state } => {
                        GameServerMessage::StateChange { player_id, state }
                    }
                    NetworkEvent::AttackStarted { player_id, chain_stage } => {
                        GameServerMessage::AttackStarted { player_id, chain_stage }
                    }
                    NetworkEvent::SkillUsed { player_id, skill_slot } => {
                        GameServerMessage::SkillUsed { player_id, skill_slot }
                    }
                    NetworkEvent::MatchEnd { players } => GameServerMessage::MatchEnd { players },
                });
                broadcast(msg);
            }

            broadcast(Arc::new(GameServerMessage::Snapshot(snapshot)));

            let elapsed = tick_start.elapsed();
            if let Some(remaining) = TICK_DURATION.checked_sub(elapsed) {
                std::thread::sleep(remaining);
            }
        }
    }
}
