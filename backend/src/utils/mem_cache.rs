use std::{cell::LazyCell, convert::Infallible};

use parking_lot::{MappedMutexGuard, Mutex, MutexGuard};
use schnellru::{ByLength, LruMap};

/// A thread-safe in-memory cache with LRU eviction policy.
///
/// Keeps most recently used entries in the cache.
/// Can be configured to limit by number of entries or by memory usage.
#[derive(Debug)]
pub struct MemCache<K, V> {
    /// Inner LRU map protected by a mutex for thread safety.
    ///
    /// Uses ahash for fast hashing.
    /// Mutex is used instead of RwLock because write access is needed for reads to update LRU order.
    inner: Mutex<LruMap<K, V, ByLength, ahash::RandomState>>,
}

impl<K, V> MemCache<K, V>
where
    K: std::hash::Hash + PartialEq,
{
    #[inline]
    pub const fn with_max_length(max_length: u32) -> Self {
        use const_random::const_random;
        Self {
            inner: Mutex::new(LruMap::with_hasher(
                ByLength::new(max_length),
                ahash::RandomState::with_seeds(
                    const_random!(u64),
                    const_random!(u64),
                    const_random!(u64),
                    const_random!(u64),
                ),
            )),
        }
    }
}

impl<K, V> MemCache<K, V>
where
    K: std::hash::Hash + PartialEq,
{
    /// Gets a mutable reference to a value in the cache by key.
    ///
    /// Returns None if the key is not found.
    /// The returned reference is protected by a mutex guard.
    #[inline]
    pub fn get_ref<'key>(
        &'_ self,
        key: &'key K,
    ) -> Option<MappedMutexGuard<'_, V>> {
        MutexGuard::try_map(self.inner.lock(), |lru| lru.get(key)).ok()
    }

    /// Gets a cloned value in the cache by key.
    ///
    /// Returns None if the key is not found.
    #[inline]
    pub fn get(&self, key: &K) -> Option<V>
    where
        V: Clone,
    {
        self.inner.lock().get(key).cloned()
    }

    /// Gets multiple cloned values from the cache by keys.
    ///
    /// Returns a vector of options in the same order as the input keys.
    #[inline]
    pub fn many_get<'key, I>(&self, keys: I) -> Vec<Option<V>>
    where
        I: Iterator<Item = &'key K>,
        K: 'key,
        V: Clone,
    {
        let mut guard = self.inner.lock();
        keys.map(|key| guard.get(key).cloned()).collect()
    }

    /// Inserts a key-value pair into the cache.
    #[inline]
    pub fn insert(&self, key: K, value: V) {
        self.inner.lock().insert(key, value);
    }

    /// Inserts multiple key-value pairs into the cache.
    #[inline]
    pub fn many_insert<I>(&self, entries: I)
    where
        I: Iterator<Item = (K, V)>,
    {
        let mut guard = self.inner.lock();
        for (key, value) in entries {
            guard.insert(key, value);
        }
    }

    /// Removes a key-value pair from the cache by key.
    ///
    /// Returns the removed value if the key was found.
    #[inline]
    pub fn remove(&self, key: &K) -> Option<V> {
        self.inner.lock().remove(key)
    }

    /// Removes multiple key-value pairs from the cache by keys.
    ///
    /// Returns a vector of options in the same order as the input keys.
    #[inline]
    pub fn many_remove<'key, I>(&self, keys: I) -> Vec<Option<V>>
    where
        I: Iterator<Item = &'key K>,
        K: 'key,
    {
        let mut guard = self.inner.lock();
        keys.map(|key| guard.remove(key)).collect()
    }

    /// Gets a mutable reference to a value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// The returned reference is protected by a mutex guard.
    #[inline]
    pub fn get_mut_or_insert(
        &self,
        key: K,
        value: V,
    ) -> MappedMutexGuard<'_, V> {
        MutexGuard::map(self.inner.lock(), |lru| {
            let value = lru
                .get_or_insert_fallible(key, || {
                    Ok::<V, std::convert::Infallible>(value)
                })
                .expect("insertion is infallible");
            value.expect("insertion doesn't fail with the chosen limiters")
        })
    }

    /// Gets a cloned value in the cache by key,
    /// inserting it if it does not exist.
    #[inline]
    pub fn get_or_insert(&self, key: K, value: V) -> V
    where
        V: Clone,
    {
        let mut guard = self.inner.lock();
        let value = guard
            .get_or_insert_fallible(key, || {
                Ok::<V, std::convert::Infallible>(value)
            })
            .expect("insertion is infallible");
        value
            .expect("insertion doesn't fail with the chosen limiters")
            .clone()
    }

    /// Gets a mutable reference to a value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// The returned reference is protected by a mutex guard.
    /// If creating the value to insert is cheap, use 'get_*_or_insert' instead.
    /// Only returns Err if the value creation fails.
    #[inline]
    pub fn get_mut_or_insert_with<E>(
        &self,
        key: K,
        get: impl FnOnce() -> Result<V, E>,
    ) -> Result<MappedMutexGuard<'_, V>, E> {
        match MutexGuard::try_map(self.inner.lock(), |lru| lru.get(&key)) {
            Ok(mapped) => Ok(mapped),
            Err(guard) => {
                drop(guard);
                // we drop the lock here to avoid stalling other threads while we compute the value
                let value = get()?;
                let mapped = MutexGuard::map(self.inner.lock(), |lru| {
                    lru.get_or_insert_fallible(key, || {
                        Ok::<V, Infallible>(value)
                    })
                    .expect("insertion is infallible")
                    .expect("insertion doesn't fail with the chosen limiters")
                });
                Ok(mapped)
            }
        }
    }

    /// Gets a cloned value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// If creating the value to insert is cheap, use 'get_clone_or_insert' instead.
    /// Only returns Err if the value creation fails.
    #[inline]
    pub fn get_or_insert_with<E>(
        &self,
        key: K,
        get: impl FnOnce() -> Result<V, E>,
    ) -> Result<V, E>
    where
        V: Clone,
    {
        let mut guard = self.inner.lock();
        if let Some(value) = guard.get(&key) {
            return Ok(value.clone());
        }
        drop(guard);
        // we drop the lock here to avoid stalling other threads while we compute the value
        let value = get()?;
        Ok(self
            .inner
            .lock()
            .get_or_insert_fallible(key, || Ok::<V, Infallible>(value))
            .expect("insertion is infallible")
            .expect("insertion doesn't fail with the chosen limiters")
            .clone())
    }

    /// Gets a cloned value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// Only returns Err if the value creation fails.
    #[inline]
    pub fn many_get_or_insert_bulk<E, I>(
        &self,
        keys: I,
        fetch_missing: impl FnOnce(Vec<K>, &mut Vec<(K, V)>) -> Result<(), E>,
    ) -> Result<Vec<(K, V)>, E>
    where
        I: Iterator<Item = K> + ExactSizeIterator,
        K: Clone,
        V: Clone,
    {
        let keys_len = keys.len();
        let mut results = Vec::with_capacity(keys_len);
        // only allocate missing keys vector if there are any missing keys -> use LazyCell
        let mut missing = LazyCell::new(|| Vec::with_capacity(keys_len));
        let mut missing_init = false;

        {
            let mut guard = self.inner.lock();
            for key in keys {
                if let Some(value) = guard.get(&key) {
                    results.push((key.clone(), value.clone()));
                } else {
                    missing.push(key);
                    missing_init = true;
                }
            }
        }

        // TODO: cleanup when LazyCell::into_inner() is stable - https://github.com/rust-lang/rust/issues/125623
        if missing_init {
            let insert_start = results.len();
            let missing = core::mem::take(&mut *missing);
            fetch_missing(missing, &mut results)?;
            let mut guard = self.inner.lock();
            for (key, value) in &results[insert_start..] {
                guard.insert(key.clone(), value.clone());
            }
        }

        Ok(results)
    }

    /// Gets multiple cloned/copied key-value pairs from the cache by keys,
    /// inserting values created by `fetch` for missing entries.
    ///
    /// Result order is not guaranteed.
    #[inline]
    pub fn many_get_or_insert_with<E, I>(
        &self,
        keys: I,
        mut fetch: impl FnMut(&K) -> Result<V, E>,
    ) -> Result<Vec<(K, V)>, E>
    where
        I: Iterator<Item = K> + ExactSizeIterator,
        K: Clone,
        V: Clone,
    {
        self.many_get_or_insert_bulk(keys, |missing, results| {
            for key in missing {
                let value = fetch(&key)?;
                results.push((key, value));
            }
            Ok(())
        })
    }
}
