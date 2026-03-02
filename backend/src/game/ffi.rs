// FFI bindings to C++ game engine
// Updated to work with Entity-Component-System architecture
use std::ffi::{CString, c_void};
use serde::{Serialize, Deserialize};
use salvo::oapi::ToSchema;

// Opaque pointer to C++ game object
pub type GameHandle = *mut c_void;

// =============================================================================
// C-compatible structures for game events
// =============================================================================

#[repr(C)]
#[derive(Clone)]
pub struct CGameEvent {
    pub event_type: u8,
    pub player_id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    pub param1: f32,
    pub param2: f32,
}

// =============================================================================
// C-compatible structures
// =============================================================================

#[repr(C)]
pub struct CCharacterSnapshot {
    pub player_id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    pub vel_x: f32,
    pub vel_y: f32,
    pub vel_z: f32,
    pub yaw: f32,
    pub state: u8,
    pub health: f32,
    pub max_health: f32,
}

#[repr(C)]
pub struct CGameStateSnapshot {
    pub frame_number: u64,
    pub timestamp: f64,
    pub character_count: usize,
    pub characters: [CCharacterSnapshot; 32],
}

// =============================================================================
// External C functions
// =============================================================================

extern "C" {
    // Game lifecycle
    pub fn game_create() -> GameHandle;
    pub fn game_destroy(game: GameHandle);
    pub fn game_start(game: GameHandle);
    pub fn game_stop(game: GameHandle);
    pub fn game_update(game: GameHandle);
    pub fn game_is_running(game: GameHandle) -> bool;

    // Player management (backwards compatible)
    pub fn game_add_player(game: GameHandle, player_id: u32, name: *const i8) -> bool;
    pub fn game_remove_player(game: GameHandle, player_id: u32) -> bool;
    pub fn game_get_player_count(game: GameHandle) -> usize;

    // Entity management (NEW - ECS features)
    pub fn game_create_projectile(
        game: GameHandle,
        entity_id: u32,
        pos_x: f32, pos_y: f32, pos_z: f32,
        vel_x: f32, vel_y: f32, vel_z: f32,
    ) -> bool;

    pub fn game_create_wall(
        game: GameHandle,
        entity_id: u32,
        pos_x: f32, pos_y: f32, pos_z: f32,
        half_x: f32, half_y: f32, half_z: f32,
    ) -> bool;

    pub fn game_destroy_entity(game: GameHandle, entity_id: u32) -> bool;
    pub fn game_entity_exists(game: GameHandle, entity_id: u32) -> bool;
    pub fn game_entity_is_alive(game: GameHandle, entity_id: u32) -> bool;

    // Component access (NEW)
    pub fn game_get_entity_health(
        game: GameHandle,
        entity_id: u32,
        out_current: *mut f32,
        out_max: *mut f32,
    ) -> bool;

    pub fn game_set_entity_health(game: GameHandle, entity_id: u32, health: f32) -> bool;

    pub fn game_get_entity_position(
        game: GameHandle,
        entity_id: u32,
        out_x: *mut f32,
        out_y: *mut f32,
        out_z: *mut f32,
    ) -> bool;

    pub fn game_set_entity_position(
        game: GameHandle,
        entity_id: u32,
        x: f32, y: f32, z: f32,
    ) -> bool;

    pub fn game_get_entity_velocity(
        game: GameHandle,
        entity_id: u32,
        out_x: *mut f32,
        out_y: *mut f32,
        out_z: *mut f32,
    ) -> bool;

    pub fn game_set_entity_velocity(
        game: GameHandle,
        entity_id: u32,
        x: f32, y: f32, z: f32,
    ) -> bool;

    // Input handling (backwards compatible)
    pub fn game_set_input(
        game: GameHandle,
        player_id: u32,
        move_x: f32, move_y: f32, move_z: f32,
        look_x: f32, look_y: f32, look_z: f32,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
        dodging: bool,
        sprinting: bool,
    );

    // Snapshot retrieval (backwards compatible)
    pub fn game_get_snapshot(game: GameHandle, out_snapshot: *mut CGameStateSnapshot);
    pub fn game_get_frame_number(game: GameHandle) -> u64;
    pub fn game_get_game_time(game: GameHandle) -> f64;

    // Combat (backwards compatible)
    pub fn game_register_hit(game: GameHandle, attacker_id: u32, victim_id: u32, damage: f32);

    // Game events (for audio/effects)
    pub fn game_get_event_count(game: GameHandle) -> usize;
    pub fn game_drain_events(game: GameHandle, out: *mut CGameEvent, max: usize) -> usize;
}

// =============================================================================
// Rust-friendly types
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub struct Vector3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Default for Vector3D {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
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
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GameEvent {
    pub event_type: u8,
    pub player_id: u32,
    pub position: Vector3D,
    pub param1: f32,
    pub param2: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GameStateSnapshot {
    pub frame_number: u64,
    pub timestamp: f64,
    pub characters: Vec<CharacterSnapshot>,
}

// =============================================================================
// Safe Rust wrapper
// =============================================================================

pub struct Game {
    handle: GameHandle,
}

impl Game {
    pub fn new() -> Self {
        let handle = unsafe { game_create() };
        Self { handle }
    }

    pub fn start(&mut self) {
        unsafe { game_start(self.handle) }
    }

    pub fn stop(&mut self) {
        unsafe { game_stop(self.handle) }
    }

    pub fn update(&mut self) {
        unsafe { game_update(self.handle) }
    }

    pub fn is_running(&self) -> bool {
        unsafe { game_is_running(self.handle) }
    }

    // Player management
    pub fn add_player(&mut self, player_id: u32, name: &str) -> bool {
        let c_name = CString::new(name).unwrap();
        unsafe { game_add_player(self.handle, player_id, c_name.as_ptr()) }
    }

    pub fn remove_player(&mut self, player_id: u32) -> bool {
        unsafe { game_remove_player(self.handle, player_id) }
    }

    pub fn get_player_count(&self) -> usize {
        unsafe { game_get_player_count(self.handle) }
    }

    pub fn create_projectile(&mut self, entity_id: u32, position: Vector3D, velocity: Vector3D) -> bool {
        unsafe {
            game_create_projectile(
                self.handle,
                entity_id,
                position.x, position.y, position.z,
                velocity.x, velocity.y, velocity.z,
            )
        }
    }

    pub fn create_wall(&mut self, entity_id: u32, position: Vector3D, half_extents: Vector3D) -> bool {
        unsafe {
            game_create_wall(
                self.handle,
                entity_id,
                position.x, position.y, position.z,
                half_extents.x, half_extents.y, half_extents.z,
            )
        }
    }

    pub fn destroy_entity(&mut self, entity_id: u32) -> bool {
        unsafe { game_destroy_entity(self.handle, entity_id) }
    }

    pub fn entity_exists(&self, entity_id: u32) -> bool {
        unsafe { game_entity_exists(self.handle, entity_id) }
    }

    pub fn entity_is_alive(&self, entity_id: u32) -> bool {
        unsafe { game_entity_is_alive(self.handle, entity_id) }
    }

    pub fn get_entity_health(&self, entity_id: u32) -> Option<(f32, f32)> {
        let mut current = 0.0f32;
        let mut max = 0.0f32;

        unsafe {
            if game_get_entity_health(self.handle, entity_id, &mut current, &mut max) {
                Some((current, max))
            } else {
                None
            }
        }
    }

    pub fn set_entity_health(&mut self, entity_id: u32, health: f32) -> bool {
        unsafe { game_set_entity_health(self.handle, entity_id, health) }
    }

    pub fn get_entity_position(&self, entity_id: u32) -> Option<Vector3D> {
        let mut x = 0.0f32;
        let mut y = 0.0f32;
        let mut z = 0.0f32;

        unsafe {
            if game_get_entity_position(self.handle, entity_id, &mut x, &mut y, &mut z) {
                Some(Vector3D { x, y, z })
            } else {
                None
            }
        }
    }

    pub fn set_entity_position(&mut self, entity_id: u32, position: Vector3D) -> bool {
        unsafe {
            game_set_entity_position(self.handle, entity_id, position.x, position.y, position.z)
        }
    }

    pub fn get_entity_velocity(&self, entity_id: u32) -> Option<Vector3D> {
        let mut x = 0.0f32;
        let mut y = 0.0f32;
        let mut z = 0.0f32;

        unsafe {
            if game_get_entity_velocity(self.handle, entity_id, &mut x, &mut y, &mut z) {
                Some(Vector3D { x, y, z })
            } else {
                None
            }
        }
    }

    pub fn set_entity_velocity(&mut self, entity_id: u32, velocity: Vector3D) -> bool {
        unsafe {
            game_set_entity_velocity(self.handle, entity_id, velocity.x, velocity.y, velocity.z)
        }
    }

    // Input handling
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
        unsafe {
            game_set_input(
                self.handle,
                player_id,
                move_dir.x, move_dir.y, move_dir.z,
                look_dir.x, look_dir.y, look_dir.z,
                attacking,
                jumping,
                ability1,
                ability2,
                dodging,
                sprinting,
            )
        }
    }

    pub fn get_snapshot(&self) -> GameStateSnapshot {
        let mut c_snapshot = std::mem::MaybeUninit::<CGameStateSnapshot>::uninit();

        unsafe {
            game_get_snapshot(self.handle, c_snapshot.as_mut_ptr());
            let c_snapshot = c_snapshot.assume_init();

            let characters = (0..c_snapshot.character_count)
                .map(|i| {
                    let c = &c_snapshot.characters[i];
                    CharacterSnapshot {
                        player_id: c.player_id,
                        position: Vector3D {
                            x: c.pos_x,
                            y: c.pos_y,
                            z: c.pos_z,
                        },
                        velocity: Vector3D {
                            x: c.vel_x,
                            y: c.vel_y,
                            z: c.vel_z,
                        },
                        yaw: c.yaw,
                        state: c.state,
                        health: c.health,
                        max_health: c.max_health,
                    }
                })
                .collect();

            GameStateSnapshot {
                frame_number: c_snapshot.frame_number,
                timestamp: c_snapshot.timestamp,
                characters,
            }
        }
    }

    pub fn get_frame_number(&self) -> u64 {
        unsafe { game_get_frame_number(self.handle) }
    }

    pub fn get_game_time(&self) -> f64 {
        unsafe { game_get_game_time(self.handle) }
    }

    pub fn register_hit(&mut self, attacker_id: u32, victim_id: u32, damage: f32) {
        unsafe { game_register_hit(self.handle, attacker_id, victim_id, damage) }
    }

    pub fn drain_events(&mut self) -> Vec<GameEvent> {
        let count = unsafe { game_get_event_count(self.handle) };
        if count == 0 {
            return Vec::new();
        }

        let mut c_events = vec![
            CGameEvent {
                event_type: 0,
                player_id: 0,
                pos_x: 0.0, pos_y: 0.0, pos_z: 0.0,
                param1: 0.0, param2: 0.0,
            };
            count.min(64)
        ];

        let drained = unsafe {
            game_drain_events(self.handle, c_events.as_mut_ptr(), c_events.len())
        };

        c_events.truncate(drained);
        c_events.into_iter().map(|c| GameEvent {
            event_type: c.event_type,
            player_id: c.player_id,
            position: Vector3D { x: c.pos_x, y: c.pos_y, z: c.pos_z },
            param1: c.param1,
            param2: c.param2,
        }).collect()
    }
}

impl Drop for Game {
    fn drop(&mut self) {
        unsafe { game_destroy(self.handle) }
    }
}

// Thread-safe because C++ engine handles its own synchronization
unsafe impl Send for Game {}
unsafe impl Sync for Game {}
