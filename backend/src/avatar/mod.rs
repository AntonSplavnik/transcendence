//! Avatar module for user profile images.
//!
//! Handles storage, validation, and caching of user avatars in AVIF format.
//! Two sizes are supported:
//! - Large: 450x450 pixels (~12kb)
//! - Small: 200x200 pixels (~4kb)
//!
//! Images are stored in SQLite for transactional consistency.
//! Small avatars are cached in memory for fast retrieval.

pub mod cache;
pub mod router;
pub mod validate;

pub use router::router;
