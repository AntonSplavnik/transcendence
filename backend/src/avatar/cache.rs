//! In-memory cache for small avatar images.
//!
//! Caches small avatars (200x200, ~4kb each) to reduce database load.
//! With 1000 users cached, memory usage is approximately 4MB.

use chrono::{DateTime, Utc};
use quick_cache::sync::Cache;
use std::sync::{Arc, LazyLock};

/// Cache capacity (number of avatars to cache)
const CACHE_CAPACITY: usize = 1000;

/// Cached avatar data with timestamp for ETag generation
#[derive(Clone)]
pub struct CachedAvatar {
    pub data: Arc<Vec<u8>>,
    pub updated_at: DateTime<Utc>,
}

/// Global cache for small avatars
static SMALL_AVATAR_CACHE: LazyLock<Cache<i32, CachedAvatar>> =
    LazyLock::new(|| Cache::new(CACHE_CAPACITY));

/// Get a small avatar from cache
pub fn get(user_id: i32) -> Option<CachedAvatar> {
    SMALL_AVATAR_CACHE.get(&user_id)
}

/// Insert a small avatar into the cache
pub fn insert(user_id: i32, data: Vec<u8>, updated_at: DateTime<Utc>) {
    SMALL_AVATAR_CACHE.insert(
        user_id,
        CachedAvatar {
            data: Arc::new(data),
            updated_at,
        },
    );
}

/// Remove a small avatar from the cache (call when avatar is updated/deleted)
pub fn invalidate(user_id: i32) {
    SMALL_AVATAR_CACHE.remove(&user_id);
}
