//! In-memory cache for small avatar images.
//!
//! Caches small avatars (200x200, ~4kb each) to reduce database load.
//! With 1000 users cached, memory usage is approximately 4MB.

use quick_cache::sync::Cache;
use std::sync::{Arc, LazyLock};

/// Cache capacity (number of avatars to cache)
const CACHE_CAPACITY: usize = 1000;

/// Cached avatar data (Arc for cheap cloning)
pub type CachedAvatar = Arc<Vec<u8>>;

// TODO remove global cache and replace with injected shared value
// via affix_state::inject inside crate::router::api_router()
// need to make wrapper struct around TTIMemCache
// then remove quick_cache dependency, as its no longer needed

/// Global cache for small avatars
static SMALL_AVATAR_CACHE: LazyLock<Cache<i32, CachedAvatar>> =
    LazyLock::new(|| Cache::new(CACHE_CAPACITY));

/// Get a small avatar from cache
pub fn get(user_id: i32) -> Option<CachedAvatar> {
    SMALL_AVATAR_CACHE.get(&user_id)
}

/// Insert a small avatar into the cache
pub fn insert(user_id: i32, data: Vec<u8>) {
    SMALL_AVATAR_CACHE.insert(user_id, Arc::new(data));
}

/// Remove a small avatar from the cache (call when avatar is updated/deleted)
pub fn invalidate(user_id: i32) {
    SMALL_AVATAR_CACHE.remove(&user_id);
}
