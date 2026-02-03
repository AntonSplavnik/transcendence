use std::{cell::LazyCell, convert::Infallible, hash::Hash};

use parking_lot::{MappedMutexGuard, Mutex, MutexGuard};
use schnellru::{ByLength, LruMap};
use smallvec::SmallVec;

/// A thread-safe in-memory cache with time-to-idle eviction policy.
///
/// Keeps entries in the cache as long as they are accessed at least once within the specified duration.
/// Clone is cheap as it only creates a new handle to the same underlying cache.
#[derive(Debug, Clone)]
pub struct TTIMemCache<K: Eq + Hash, V>(
    mini_moka::sync::Cache<K, V, ahash::RandomState>,
);

impl<K, V> TTIMemCache<K, V>
where
    K: Hash + Eq + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
{
    /// Creates a new unbounded cache with the specified time to idle (TTI).
    ///
    /// Entries will be automatically evicted if they have not been accessed for the specified duration.
    /// The cache has no capacity limit; entries are only removed by TTI expiration.
    #[inline]
    pub fn unbounded_with_tti(tti: std::time::Duration) -> Self {
        Self(
            mini_moka::sync::Cache::builder()
                .time_to_idle(tti)
                .initial_capacity(128)
                .build_with_hasher(Default::default()),
        )
    }

    /// Creates a new cache with the specified max capacity and time to idle (TTI).
    ///
    /// Entries will be automatically evicted if they have not been accessed for the specified duration,
    /// or if the cache exceeds the max capacity.
    #[inline]
    pub fn with_tti(max_capacity: u64, tti: std::time::Duration) -> Self {
        Self(
            mini_moka::sync::Cache::builder()
                .max_capacity(max_capacity)
                .time_to_idle(tti)
                .initial_capacity(128)
                .build_with_hasher(Default::default()),
        )
    }

    /// Gets a cloned value in the cache by key,
    /// inserting it if it does not exist.
    ///
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
        if let Some(value) = self.0.get(&key) {
            return Ok(value);
        }
        let value = get()?;
        self.0.insert(key, value.clone());
        Ok(value)
    }

    /// Gets a cloned value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// Only returns Err if the value creation fails.
    #[inline]
    pub fn many_get_or_insert_bulk<E, I, const N: usize, const M: usize>(
        &self,
        keys: I,
        fetch_missing: impl FnOnce(
            SmallVec<[K; M]>,
            &mut SmallVec<[(K, V); N]>,
        ) -> Result<(), E>,
    ) -> Result<SmallVec<[(K, V); N]>, E>
    where
        I: IntoIterator<Item = K>,
        K: Clone,
        V: Clone,
    {
        let keys = keys.into_iter();
        let keys_size_hint = keys.size_hint().0;
        let mut results = SmallVec::with_capacity(keys_size_hint);
        // only allocate missing keys vector if there are any missing keys -> use LazyCell
        let mut missing =
            LazyCell::new(|| SmallVec::with_capacity(keys_size_hint));
        let mut missing_init = false;

        for key in keys {
            if let Some(value) = self.0.get(&key) {
                results.push((key, value.clone()));
            } else {
                missing.push(key);
                missing_init = true;
            }
        }

        // TODO: cleanup when LazyCell::into_inner() is stable - https://github.com/rust-lang/rust/issues/125623
        if missing_init {
            let insert_start = results.len();
            let missing = core::mem::take(&mut *missing);
            fetch_missing(missing, &mut results)?;
            for (key, value) in &results[insert_start..] {
                self.0.insert(key.clone(), value.clone());
            }
        }

        Ok(results)
    }

    /// Gets multiple cloned/copied key-value pairs from the cache by keys,
    /// inserting values created by `fetch` for missing entries.
    ///
    /// Result order is not guaranteed.
    #[inline]
    pub fn many_get_or_insert_with<E, I, const N: usize, const M: usize>(
        &self,
        keys: I,
        mut fetch: impl FnMut(&K) -> Result<V, E>,
    ) -> Result<SmallVec<[(K, V); N]>, E>
    where
        I: IntoIterator<Item = K>,
        K: Clone,
        V: Clone,
    {
        let keys = keys.into_iter();
        let keys_size_hint = keys.size_hint().0;
        let mut results = SmallVec::with_capacity(keys_size_hint);
        for key in keys {
            if let Some(value) = self.0.get(&key) {
                results.push((key, value.clone()));
                continue;
            }
            let value = fetch(&key)?;
            results.push((key.clone(), value.clone()));
            self.0.insert(key, value);
        }
        Ok(results)
    }
}

impl<K, V> std::ops::Deref for TTIMemCache<K, V>
where
    K: Eq + Hash,
{
    type Target = mini_moka::sync::Cache<K, V, ahash::RandomState>;

    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

/// A thread-safe in-memory cache with LRU eviction policy.
///
/// Keeps most recently used entries in the cache.
/// Can be configured to limit by number of entries.
#[derive(Debug)]
pub struct LruMemCache<K, V> {
    /// Inner LRU map protected by a mutex for thread safety.
    ///
    /// Uses ahash for fast hashing.
    /// Mutex is used instead of RwLock because write access is needed for reads to update LRU order.
    inner: Mutex<LruMap<K, V, ByLength, ahash::RandomState>>,
}

impl<K, V> LruMemCache<K, V>
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

impl<K, V> LruMemCache<K, V>
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
        I: IntoIterator<Item = &'key K>,
        K: 'key,
        V: Clone,
    {
        let mut guard = self.inner.lock();
        keys.into_iter()
            .map(|key| guard.get(key).cloned())
            .collect()
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
        I: IntoIterator<Item = &'key K>,
        K: 'key,
    {
        let mut guard = self.inner.lock();
        keys.into_iter().map(|key| guard.remove(key)).collect()
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
    pub fn many_get_or_insert_bulk<E, I, const N: usize, const M: usize>(
        &self,
        keys: I,
        fetch_missing: impl FnOnce(
            SmallVec<[K; M]>,
            &mut SmallVec<[(K, V); N]>,
        ) -> Result<(), E>,
    ) -> Result<SmallVec<[(K, V); N]>, E>
    where
        I: IntoIterator<Item = K>,
        K: Clone,
        V: Clone,
    {
        let keys = keys.into_iter();
        let keys_size_hint = keys.size_hint().0;
        let mut results = SmallVec::with_capacity(keys_size_hint);
        // only allocate missing keys vector if there are any missing keys -> use LazyCell
        let mut missing =
            LazyCell::new(|| SmallVec::with_capacity(keys_size_hint));
        let mut missing_init = false;

        {
            let mut guard = self.inner.lock();
            for key in keys {
                if let Some(value) = guard.get(&key) {
                    results.push((key, value.clone()));
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
    pub fn many_get_or_insert_with<E, I, const N: usize, const M: usize>(
        &self,
        keys: I,
        mut fetch: impl FnMut(&K) -> Result<V, E>,
    ) -> Result<SmallVec<[(K, V); N]>, E>
    where
        I: IntoIterator<Item = K>,
        K: Clone,
        V: Clone,
    {
        self.many_get_or_insert_bulk(
            keys,
            |missing: SmallVec<[K; M]>, results| {
                for key in missing {
                    let value = fetch(&key)?;
                    results.push((key, value));
                }
                Ok(())
            },
        )
    }
}
