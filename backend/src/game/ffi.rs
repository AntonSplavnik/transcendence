// FFI bindings to C++ game engine
// Updated to work with Entity-Component-System architecture
use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};
use std::ffi::{c_void, CString};

// Opaque pointer to C++ game object
type RawGameHandle = *mut c_void;

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

#[allow(dead_code)]
extern "C" {
    // Game lifecycle
    fn game_create() -> RawGameHandle;
    fn game_destroy(game: RawGameHandle);
    fn game_start(game: RawGameHandle);
    fn game_stop(game: RawGameHandle);
    fn game_update(game: RawGameHandle);
    fn game_is_running(game: RawGameHandle) -> bool;

    // Player management
    fn game_add_player(game: RawGameHandle, player_id: u32, name: *const i8) -> bool;
    fn game_remove_player(game: RawGameHandle, player_id: u32) -> bool;
    fn game_get_player_count(game: RawGameHandle) -> usize;

    // Entity management
    fn game_create_projectile(
        game: RawGameHandle,
        entity_id: u32,
        pos_x: f32,
        pos_y: f32,
        pos_z: f32,
        vel_x: f32,
        vel_y: f32,
        vel_z: f32,
    ) -> bool;

    fn game_create_wall(
        game: RawGameHandle,
        entity_id: u32,
        pos_x: f32,
        pos_y: f32,
        pos_z: f32,
        half_x: f32,
        half_y: f32,
        half_z: f32,
    ) -> bool;

    fn game_destroy_entity(game: RawGameHandle, entity_id: u32) -> bool;
    fn game_entity_exists(game: RawGameHandle, entity_id: u32) -> bool;
    fn game_entity_is_alive(game: RawGameHandle, entity_id: u32) -> bool;

    // Component access
    fn game_get_entity_health(
        game: RawGameHandle,
        entity_id: u32,
        out_current: *mut f32,
        out_max: *mut f32,
    ) -> bool;

    fn game_set_entity_health(game: RawGameHandle, entity_id: u32, health: f32) -> bool;

    fn game_get_entity_position(
        game: RawGameHandle,
        entity_id: u32,
        out_x: *mut f32,
        out_y: *mut f32,
        out_z: *mut f32,
    ) -> bool;

    fn game_set_entity_position(
        game: RawGameHandle,
        entity_id: u32,
        x: f32,
        y: f32,
        z: f32,
    ) -> bool;

    fn game_get_entity_velocity(
        game: RawGameHandle,
        entity_id: u32,
        out_x: *mut f32,
        out_y: *mut f32,
        out_z: *mut f32,
    ) -> bool;

    fn game_set_entity_velocity(
        game: RawGameHandle,
        entity_id: u32,
        x: f32,
        y: f32,
        z: f32,
    ) -> bool;

    // Input handling
    fn game_set_input(
        game: RawGameHandle,
        player_id: u32,
        move_x: f32,
        move_y: f32,
        move_z: f32,
        look_x: f32,
        look_y: f32,
        look_z: f32,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
        dodging: bool,
        sprinting: bool,
    );

    // Snapshot retrieval
    fn game_get_snapshot(game: RawGameHandle, out_snapshot: *mut CGameStateSnapshot);
    fn game_get_frame_number(game: RawGameHandle) -> u64;
    fn game_get_game_time(game: RawGameHandle) -> f64;

    // Combat
    fn game_register_hit(game: RawGameHandle, attacker_id: u32, victim_id: u32, damage: f32);
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
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GameStateSnapshot {
    pub frame_number: u64,
    pub timestamp: f64,
    pub characters: Vec<CharacterSnapshot>,
}

pub struct GameHandle(RawGameHandle);

// SAFETY: The underlying C++ game engine is only accessed through
// `parking_lot::Mutex<GameHandle>` (in `Game`), ensuring exclusive
// access. The raw pointer is never aliased across threads.
unsafe impl Send for GameHandle {}

#[allow(dead_code)]
impl GameHandle {
    pub(super) fn new(_gamemode: &str) -> Self {
        Self(unsafe { game_create() })
    }

    /// The gamemode name for this game.
    ///
    /// TODO: replace with `game_get_gamemode(RawGameHandle) -> *const c_char`
    /// FFI call once the C++ side exposes per-gamemode configuration.
    pub fn gamemode(&self) -> &str {
        "Free for all"
    }

    pub fn start(&mut self) {
        unsafe { game_start(self.0) }
    }

    pub fn stop(&mut self) {
        unsafe { game_stop(self.0) }
    }

    pub fn update(&mut self) {
        unsafe { game_update(self.0) }
    }

    pub fn is_running(&self) -> bool {
        unsafe { game_is_running(self.0) }
    }

    pub fn add_player(&mut self, player_id: u32, name: &str) -> bool {
        let c_name = CString::new(name).unwrap();
        unsafe { game_add_player(self.0, player_id, c_name.as_ptr()) }
    }

    pub fn remove_player(&mut self, player_id: u32) -> bool {
        unsafe { game_remove_player(self.0, player_id) }
    }

    pub fn get_player_count(&self) -> usize {
        unsafe { game_get_player_count(self.0) }
    }

    pub fn create_projectile(
        &mut self,
        entity_id: u32,
        position: Vector3D,
        velocity: Vector3D,
    ) -> bool {
        unsafe {
            game_create_projectile(
                self.0, entity_id, position.x, position.y, position.z, velocity.x, velocity.y,
                velocity.z,
            )
        }
    }

    pub fn create_wall(
        &mut self,
        entity_id: u32,
        position: Vector3D,
        half_extents: Vector3D,
    ) -> bool {
        unsafe {
            game_create_wall(
                self.0,
                entity_id,
                position.x,
                position.y,
                position.z,
                half_extents.x,
                half_extents.y,
                half_extents.z,
            )
        }
    }

    pub fn destroy_entity(&mut self, entity_id: u32) -> bool {
        unsafe { game_destroy_entity(self.0, entity_id) }
    }

    pub fn entity_exists(&self, entity_id: u32) -> bool {
        unsafe { game_entity_exists(self.0, entity_id) }
    }

    pub fn entity_is_alive(&self, entity_id: u32) -> bool {
        unsafe { game_entity_is_alive(self.0, entity_id) }
    }

    pub fn get_entity_health(&self, entity_id: u32) -> Option<(f32, f32)> {
        let mut current = 0.0f32;
        let mut max = 0.0f32;
        unsafe {
            if game_get_entity_health(self.0, entity_id, &mut current, &mut max) {
                Some((current, max))
            } else {
                None
            }
        }
    }

    pub fn set_entity_health(&mut self, entity_id: u32, health: f32) -> bool {
        unsafe { game_set_entity_health(self.0, entity_id, health) }
    }

    pub fn get_entity_position(&self, entity_id: u32) -> Option<Vector3D> {
        let mut x = 0.0f32;
        let mut y = 0.0f32;
        let mut z = 0.0f32;
        unsafe {
            if game_get_entity_position(self.0, entity_id, &mut x, &mut y, &mut z) {
                Some(Vector3D { x, y, z })
            } else {
                None
            }
        }
    }

    pub fn set_entity_position(&mut self, entity_id: u32, position: Vector3D) -> bool {
        unsafe { game_set_entity_position(self.0, entity_id, position.x, position.y, position.z) }
    }

    pub fn get_entity_velocity(&self, entity_id: u32) -> Option<Vector3D> {
        let mut x = 0.0f32;
        let mut y = 0.0f32;
        let mut z = 0.0f32;
        unsafe {
            if game_get_entity_velocity(self.0, entity_id, &mut x, &mut y, &mut z) {
                Some(Vector3D { x, y, z })
            } else {
                None
            }
        }
    }

    pub fn set_entity_velocity(&mut self, entity_id: u32, velocity: Vector3D) -> bool {
        unsafe { game_set_entity_velocity(self.0, entity_id, velocity.x, velocity.y, velocity.z) }
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
        unsafe {
            game_set_input(
                self.0, player_id, move_dir.x, move_dir.y, move_dir.z, look_dir.x, look_dir.y,
                look_dir.z, attacking, jumping, ability1, ability2, dodging, sprinting,
            )
        }
    }

    pub fn get_snapshot(&self) -> GameStateSnapshot {
        let mut c_snapshot = std::mem::MaybeUninit::<CGameStateSnapshot>::uninit();
        unsafe {
            game_get_snapshot(self.0, c_snapshot.as_mut_ptr());
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
        unsafe { game_get_frame_number(self.0) }
    }

    pub fn get_game_time(&self) -> f64 {
        unsafe { game_get_game_time(self.0) }
    }

    pub fn register_hit(&mut self, attacker_id: u32, victim_id: u32, damage: f32) {
        unsafe { game_register_hit(self.0, attacker_id, victim_id, damage) }
    }

    /// Minimum number of players required to start a game.
    ///
    /// TODO: replace with `game_get_min_players(RawGameHandle) -> u32` FFI call
    /// once the C++ side exposes per-gamemode configuration.
    pub fn min_players(&self) -> u32 {
        2
    }

    /// Maximum number of players allowed in a game.
    ///
    /// TODO: replace with `game_get_max_players(RawGameHandle) -> u32` FFI call
    /// once the C++ side exposes per-gamemode configuration.
    pub fn max_players(&self) -> u32 {
        8
    }
}

impl Drop for GameHandle {
    fn drop(&mut self) {
        unsafe { game_destroy(self.0) }
    }
}
