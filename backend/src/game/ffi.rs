// FFI bindings to C++ game engine
use std::ffi::{CString, c_void};
use serde::{Serialize, Deserialize};
use salvo::oapi::ToSchema;

// Opaque pointer to C++ game object
pub type GameHandle = *mut c_void;

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
    pub fn game_create() -> GameHandle;
    pub fn game_destroy(game: GameHandle);
    pub fn game_start(game: GameHandle);
    pub fn game_stop(game: GameHandle);
    pub fn game_update(game: GameHandle);
    pub fn game_is_running(game: GameHandle) -> bool;

    pub fn game_add_player(game: GameHandle, player_id: u32, name: *const i8) -> bool;
    pub fn game_remove_player(game: GameHandle, player_id: u32) -> bool;
    pub fn game_get_player_count(game: GameHandle) -> usize;

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
    );

    pub fn game_get_snapshot(game: GameHandle, out_snapshot: *mut CGameStateSnapshot);
    pub fn game_get_frame_number(game: GameHandle) -> u64;
    pub fn game_get_game_time(game: GameHandle) -> f64;
    pub fn game_register_hit(game: GameHandle, attacker_id: u32, victim_id: u32, damage: f32);
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
}

impl Drop for Game {
    fn drop(&mut self) {
        unsafe { game_destroy(self.handle) }
    }
}

// Thread-safe because C++ engine handles its own synchronization
unsafe impl Send for Game {}
unsafe impl Sync for Game {}
