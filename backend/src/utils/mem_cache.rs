use parking_lot::{MappedMutexGuard, Mutex, MutexGuard};
use schnellru::{ByLength, ByMemoryUsage, Limiter, LruMap};
use std::hash::Hash;

/// A thread-safe in-memory cache with LRU eviction policy.
///
/// Keeps most recently used entries in the cache.
/// Can be configured to limit by number of entries or by memory usage.
#[derive(Debug)]
pub struct MemCache<K, V, L>
where
    L: Limiter<K, V>,
{
    /// Inner LRU map protected by a mutex for thread safety.
    ///
    /// Uses ahash for fast hashing.
    /// Mutex is used instead of RwLock because write access is needed for reads to update LRU order.
    inner: Mutex<LruMap<K, V, L, ahash::RandomState>>,
}

impl<K, V> MemCache<K, V, ByLength>
where
    K: std::hash::Hash + PartialEq,
{
    #[inline]
    pub fn with_max_length(max_length: u32) -> Self {
        Self {
            inner: Mutex::new(LruMap::with_hasher(
                ByLength::new(max_length),
                ahash::RandomState::new(),
            )),
        }
    }
}

impl<K, V> MemCache<K, V, ByMemoryUsage>
where
    K: std::hash::Hash + PartialEq,
{
    /// Makes only sence to use with values that do not allocate on the heap,
    /// since this only cares about how much memory the cache itself is allocating.
    #[inline]
    pub fn with_memory_budget(max_bytes: usize) -> Self {
        Self {
            inner: Mutex::new(LruMap::with_memory_budget_and_hasher(
                max_bytes,
                ahash::RandomState::new(),
            )),
        }
    }
}

impl<K, V, L> MemCache<K, V, L>
where
    L: Limiter<K, V>,
    K: std::hash::Hash + PartialEq,
{
    /// Gets a mutable reference to a value in the cache by key.
    ///
    /// Returns None if the key is not found.
    /// The returned reference is protected by a mutex guard.
    #[inline]
    pub fn get_mut<'key>(
        &'_ self,
        key: &'key K,
    ) -> Option<MappedMutexGuard<'_, V>> {
        MutexGuard::try_map(self.inner.lock(), |lru| lru.get(key)).ok()
    }

    #[inline]
    pub fn get_copy(&self, key: &K) -> Option<V>
    where
        V: Copy,
    {
        self.inner.lock().get(key).copied()
    }

    #[inline]
    pub fn get_clone(&self, key: &K) -> Option<V>
    where
        V: Clone,
    {
        self.inner.lock().get(key).cloned()
    }

    /// Inserts a key-value pair into the cache.
    ///
    /// Always succeeds with the chosen limiters.
    #[inline]
    pub fn insert<'a>(&self, key: L::KeyToInsert<'a>, value: V)
    where
        L::KeyToInsert<'a>: Hash + PartialEq<K>,
    {
        self.inner.lock().insert(key, value);
    }

    /// Removes a key-value pair from the cache by key.
    ///
    /// Returns the removed value if the key was found.
    #[inline]
    pub fn remove(&self, key: &K) -> Option<V> {
        self.inner.lock().remove(key)
    }

    /// Gets a mutable reference to a value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// The returned reference is protected by a mutex guard.
    #[inline]
    pub fn get_mut_or_insert<'a>(
        &self,
        key: impl Into<L::KeyToInsert<'a>> + Hash + PartialEq<K> + ?Sized,
        value: V,
    ) -> MappedMutexGuard<'_, V>
    where
        L::KeyToInsert<'a>: Hash + PartialEq<K>,
    {
        self.get_mut_or_insert_with(key, || {
            Ok::<V, std::convert::Infallible>(value)
        })
        .expect("insertion doesn't fail with the chosen limiters")
    }

    /// Gets a copy of a value in the cache by key,
    /// inserting it if it does not exist.
    #[inline]
    pub fn get_copy_or_insert<'a>(
        &self,
        key: impl Into<L::KeyToInsert<'a>> + Hash + PartialEq<K> + ?Sized,
        value: V,
    ) -> V
    where
        L::KeyToInsert<'a>: Hash + PartialEq<K>,
        V: Copy,
    {
        self.get_copy_or_insert_with(key, || {
            Ok::<V, std::convert::Infallible>(value)
        })
        .expect("insertion doesn't fail with the chosen limiters")
    }

    /// Gets a cloned value in the cache by key,
    /// inserting it if it does not exist.
    #[inline]
    pub fn get_clone_or_insert<'a>(
        &self,
        key: impl Into<L::KeyToInsert<'a>> + Hash + PartialEq<K> + ?Sized,
        value: V,
    ) -> V
    where
        L::KeyToInsert<'a>: Hash + PartialEq<K>,
        V: Clone,
    {
        self.get_clone_or_insert_with(key, || {
            Ok::<V, std::convert::Infallible>(value)
        })
        .expect("insertion doesn't fail with the chosen limiters")
    }

    /// Gets a mutable reference to a value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// The returned reference is protected by a mutex guard.
    /// If creating the value to insert is cheap, use 'get_*_or_insert' instead.
    /// Only returns Err if the value creation fails.
    #[inline]
    pub fn get_mut_or_insert_with<'a, E>(
        &self,
        key: impl Into<L::KeyToInsert<'a>> + Hash + PartialEq<K> + ?Sized,
        get: impl FnOnce() -> Result<V, E>,
    ) -> Result<MappedMutexGuard<'_, V>, E>
    where
        L::KeyToInsert<'a>: Hash + PartialEq<K>,
    {
        match MutexGuard::try_map(self.inner.lock(), |lru| lru.get(&key)) {
            Ok(mapped) => Ok(mapped),
            Err(guard) => {
                drop(guard);
                // we drop the lock here to avoid stalling other threads while we compute the value
                let value = get()?;
                let mapped =
                    MutexGuard::map(self.inner.lock(), |lru| {
                        match lru.get_or_insert_fallible(key, || Ok(value)) {
                        Ok(value) => value.expect(
                            "insertion doesn't fail with the chosen limiters",
                        ),
                        Err(()) => unreachable!(),
                    }
                    });
                Ok(mapped)
            }
        }
    }

    /// Gets a copy of a value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// If creating the value to insert is cheap, use 'get_copy_or_insert' instead.
    /// Only returns Err if the value creation fails.
    #[inline]
    pub fn get_copy_or_insert_with<'a, E>(
        &self,
        key: impl Into<L::KeyToInsert<'a>> + Hash + PartialEq<K> + ?Sized,
        get: impl FnOnce() -> Result<V, E>,
    ) -> Result<V, E>
    where
        L::KeyToInsert<'a>: Hash + PartialEq<K>,
        V: Copy,
    {
        {
            let mut guard = self.inner.lock();
            if let Some(value) = guard.get(&key) {
                return Ok(*value);
            }
        }
        // we drop the lock here to avoid stalling other threads while we compute the value
        let value = get()?;
        let mut guard = self.inner.lock();
        let value = match guard.get_or_insert_fallible(key, || Ok(value)) {
            Ok(value) => {
                value.expect("insertion doesn't fail with the chosen limiters")
            }
            Err(()) => unreachable!(),
        };
        Ok(*value)
    }

    /// Gets a cloned value in the cache by key,
    /// inserting it if it does not exist.
    ///
    /// If creating the value to insert is cheap, use 'get_clone_or_insert' instead.
    /// Only returns Err if the value creation fails.
    #[inline]
    pub fn get_clone_or_insert_with<'a, E>(
        &self,
        key: impl Into<L::KeyToInsert<'a>> + Hash + PartialEq<K> + ?Sized,
        get: impl FnOnce() -> Result<V, E>,
    ) -> Result<V, E>
    where
        L::KeyToInsert<'a>: Hash + PartialEq<K>,
        V: Clone,
    {
        {
            if let Some(value) = self.inner.lock().get(&key) {
                return Ok(value.clone());
            }
        }
        // we drop the lock here to avoid stalling other threads while we compute the value
        let value = get()?;
        let mut guard = self.inner.lock();
        let value = match guard.get_or_insert_fallible(key, || Ok(value)) {
            Ok(value) => {
                value.expect("insertion doesn't fail with the chosen limiters")
            }
            Err(()) => unreachable!(),
        };
        Ok(value.clone())
    }
}
