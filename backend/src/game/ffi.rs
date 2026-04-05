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
	// Cooldown data
	pub ability1_timer: f32,
	pub ability1_cooldown: f32,
	pub ability2_timer: f32,
	pub ability2_cooldown: f32,
	pub swing_progress: f32,
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
	fn game_start_with_mode(game: RawGameHandle, mode_type: u8);
	fn game_stop(game: RawGameHandle);
	fn game_update(game: RawGameHandle);
	fn game_is_running(game: RawGameHandle) -> bool;

	// Match state
	fn game_is_match_over(game: RawGameHandle) -> bool;
	fn game_get_match_status(game: RawGameHandle) -> u8;

	// Player management
	fn game_add_player(game: RawGameHandle, player_id: u32, name: *const i8) -> bool;
	fn game_remove_player(game: RawGameHandle, player_id: u32) -> bool;
	fn game_get_player_count(game: RawGameHandle) -> usize;

	 // Entity management
/*    fn game_create_projectile(
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
*/
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

	// Network events
	fn game_pop_network_event(game: RawGameHandle, out_event: *mut CNetworkEvent) -> bool;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub enum CharacterClass {
	#[default]
	Knight,
	Rogue,
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
	// Cooldown data
	pub ability1_timer: f32,
	pub ability1_cooldown: f32,
	pub ability2_timer: f32,
	pub ability2_cooldown: f32,
	pub swing_progress: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GameStateSnapshot {
	pub frame_number: u64,
	pub timestamp: f64,
	pub characters: Vec<CharacterSnapshot>,
}

// =============================================================================
// Network Events (tagged union mirrored from C++)
// =============================================================================

#[repr(C)]
#[derive(Copy, Clone)]
pub struct CDeathEventPayload {
	pub killer: u32,
	pub victim: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct CDamageEventPayload {
	pub attacker: u32,
	pub victim: u32,
	pub damage: f32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct CSpawnEventPayload {
	pub player_id: u32,
	pub pos_x: f32,
	pub pos_y: f32,
	pub pos_z: f32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct CStateChangePayload {
	pub player_id: u32,
	pub state: u8,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub union CNetworkEventPayload {
	pub death: CDeathEventPayload,
	pub damage: CDamageEventPayload,
	pub spawn: CSpawnEventPayload,
	pub state_change: CStateChangePayload,
	pub _empty: [u8; 0],
}

#[repr(C)]
pub struct CNetworkEvent {
	pub tag: u8,
	pub payload: CNetworkEventPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NetworkEvent {
	Death { killer: u32, victim: u32 },
	Damage { attacker: u32, victim: u32, damage: f32 },
	Spawn { player_id: u32, position: Vector3D },
	StateChange { player_id: u32, state: u8 },
	MatchEnd,
}

fn network_event_from_raw(raw: &CNetworkEvent) -> Option<NetworkEvent> {
	// SAFETY: `tag` selects which union variant is active. The C++ side only
	// writes the field matching `tag`, so reading the matching Rust union
	// field is well-defined.
	unsafe {
		match raw.tag {
			0 => {
				let p = raw.payload.death;
				Some(NetworkEvent::Death { killer: p.killer, victim: p.victim })
			}
			1 => {
				let p = raw.payload.damage;
				Some(NetworkEvent::Damage {
					attacker: p.attacker,
					victim: p.victim,
					damage: p.damage,
				})
			}
			2 => {
				let p = raw.payload.spawn;
				Some(NetworkEvent::Spawn {
					player_id: p.player_id,
					position: Vector3D { x: p.pos_x, y: p.pos_y, z: p.pos_z },
				})
			}
			3 => {
				let p = raw.payload.state_change;
				Some(NetworkEvent::StateChange { player_id: p.player_id, state: p.state })
			}
			4 => Some(NetworkEvent::MatchEnd),
			_ => None,
		}
	}
}

/// Maps a gamemode name to its C++ `GameModeType` u8 value.
/// Returns `None` for unknown names.
pub fn parse_game_mode(name: &str) -> Option<u8> {
	match name.to_lowercase().as_str() {
		"deathmatch" | "ffa" | "free_for_all"       => Some(0),
		"last_standing" | "laststanding"             => Some(1),
		"wave_survival" | "wavesurvival"             => Some(2),
		"team_deathmatch" | "teamdeathmatch" | "tdm" => Some(3),
		_ => None,
	}
}

pub fn mode_type_name(mode_type: u8) -> &'static str {
	match mode_type {
		1 => "Last Standing",
		2 => "Wave Survival",
		3 => "Team Deathmatch",
		_ => "Deathmatch",
	}
}

pub struct GameHandle(RawGameHandle);

// SAFETY: The underlying C++ game engine is only accessed through
// `parking_lot::Mutex<GameHandle>` (in `Game`), ensuring exclusive
// access. The raw pointer is never aliased across threads.
unsafe impl Send for GameHandle {}

#[allow(dead_code)]
impl GameHandle {
	pub(super) fn new() -> Self {
		Self(unsafe { game_create() })
	}

	/// `mode_type` must come from `parse_game_mode` — the C++ engine will
	/// invoke undefined behaviour for any value outside 0–3.
	pub fn start(&mut self, mode_type: u8) {
		unsafe { game_start_with_mode(self.0, mode_type) }
	}

	pub fn is_match_over(&self) -> bool {
		unsafe { game_is_match_over(self.0) }
	}

	pub fn get_match_status(&self) -> u8 {
		unsafe { game_get_match_status(self.0) }
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
/*
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
 */
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
						ability1_timer: c.ability1_timer,
						ability1_cooldown: c.ability1_cooldown,
						ability2_timer: c.ability2_timer,
						ability2_cooldown: c.ability2_cooldown,
						swing_progress: c.swing_progress,
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

	pub fn pop_network_event(&mut self) -> Option<NetworkEvent> {
		let mut raw = std::mem::MaybeUninit::<CNetworkEvent>::uninit();
		unsafe {
			if !game_pop_network_event(self.0, raw.as_mut_ptr()) {
				return None;
			}
			network_event_from_raw(&raw.assume_init())
		}
	}

	pub fn drain_network_events(&mut self) -> Vec<NetworkEvent> {
		let mut out = Vec::new();
		while let Some(ev) = self.pop_network_event() {
			out.push(ev);
		}
		out
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn converts_death_event() {
		let raw = CNetworkEvent {
			tag: 0,
			payload: CNetworkEventPayload {
				death: CDeathEventPayload { killer: 7, victim: 3 },
			},
		};
		match network_event_from_raw(&raw) {
			Some(NetworkEvent::Death { killer, victim }) => {
				assert_eq!(killer, 7);
				assert_eq!(victim, 3);
			}
			other => panic!("expected Death, got {:?}", other),
		}
	}

	#[test]
	fn converts_damage_event() {
		let raw = CNetworkEvent {
			tag: 1,
			payload: CNetworkEventPayload {
				damage: CDamageEventPayload { attacker: 11, victim: 22, damage: 17.5 },
			},
		};
		match network_event_from_raw(&raw) {
			Some(NetworkEvent::Damage { attacker, victim, damage }) => {
				assert_eq!(attacker, 11);
				assert_eq!(victim, 22);
				assert_eq!(damage, 17.5);
			}
			other => panic!("expected Damage, got {:?}", other),
		}
	}

	#[test]
	fn converts_spawn_event() {
		let raw = CNetworkEvent {
			tag: 2,
			payload: CNetworkEventPayload {
				spawn: CSpawnEventPayload { player_id: 5, pos_x: 1.0, pos_y: 2.0, pos_z: 3.0 },
			},
		};
		match network_event_from_raw(&raw) {
			Some(NetworkEvent::Spawn { player_id, position }) => {
				assert_eq!(player_id, 5);
				assert_eq!(position.x, 1.0);
				assert_eq!(position.y, 2.0);
				assert_eq!(position.z, 3.0);
			}
			other => panic!("expected Spawn, got {:?}", other),
		}
	}

	#[test]
	fn converts_state_change_event() {
		let raw = CNetworkEvent {
			tag: 3,
			payload: CNetworkEventPayload {
				state_change: CStateChangePayload { player_id: 9, state: 2 },
			},
		};
		match network_event_from_raw(&raw) {
			Some(NetworkEvent::StateChange { player_id, state }) => {
				assert_eq!(player_id, 9);
				assert_eq!(state, 2);
			}
			other => panic!("expected StateChange, got {:?}", other),
		}
	}

	#[test]
	fn converts_match_end_event() {
		let raw = CNetworkEvent {
			tag: 4,
			payload: CNetworkEventPayload { _empty: [] },
		};
		match network_event_from_raw(&raw) {
			Some(NetworkEvent::MatchEnd) => {}
			other => panic!("expected MatchEnd, got {:?}", other),
		}
	}

	#[test]
	fn unknown_tag_returns_none() {
		let raw = CNetworkEvent {
			tag: 99,
			payload: CNetworkEventPayload { _empty: [] },
		};
		assert!(network_event_from_raw(&raw).is_none());
	}
}
