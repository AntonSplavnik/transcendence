use std::sync::LazyLock;
use std::time::Duration;

pub mod adaptive_buffer;
pub mod limiter;
pub mod logger;
pub mod mem_cache;
pub mod nick_cache;

/// Time-to-idle duration for the nickname cache.
///
/// Entries not accessed within this window are evicted automatically.
const NICK_CACHE_TTI: Duration = Duration::from_secs(30 * 60); // 30 minutes

pub type NickCache = nick_cache::NickTTICache;
pub static NICK_CACHE: LazyLock<NickCache> =
    LazyLock::new(|| NickCache::new(NICK_CACHE_TTI));
