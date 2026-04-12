mod ffi;
#[allow(clippy::module_inception)]
mod game;
pub mod lobby;
pub mod lobby_messages;
pub mod manager;
mod messages;
mod router;

pub use manager::{GameError, GameManager};
pub use router::router;
