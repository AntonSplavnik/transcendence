//! Adaptive buffer that automatically shrinks when capacity grows too large.
//!
//! This module provides [`AdaptiveBuffer`], a generic wrapper around `Vec<T>`
//! that tracks usage patterns and periodically shrinks its capacity to avoid
//! holding excessive memory after rare large allocations.
//!
//! # Example
//!
//! ```
//! use crate::utils::adaptive_buffer::{AdaptiveBuffer, DefaultBufferParams};
//!
//! // Create a buffer for bytes with default parameters
//! let mut buf: AdaptiveBuffer<u8> = AdaptiveBuffer::new();
//!
//! // Use the inner vec for serialization
//! buf.as_mut_vec().extend_from_slice(b"hello world");
//!
//! // After use, call finish() to clear and potentially shrink
//! buf.finish();
//! ```
//!
//! # Custom Parameters
//!
//! Define your own parameter type implementing [`BufferParams`]:
//!
//! ```
//! use crate::utils::adaptive_buffer::{AdaptiveBuffer, BufferParams};
//!
//! struct LargeBufferParams;
//! impl BufferParams for LargeBufferParams {
//!     const MIN_CAPACITY: usize = 4096;
//!     const SHRINK_FACTOR: usize = 4;
//!     const SHRINK_CHECK_INTERVAL: usize = 128;
//! }
//!
//! let mut buf: AdaptiveBuffer<u8, LargeBufferParams> = AdaptiveBuffer::new();
//! ```
//!
//! # Shrinking Policy
//!
//! The buffer tracks the maximum size seen over a window of uses. Every
//! `SHRINK_CHECK_INTERVAL` uses, if the current capacity exceeds
//! `SHRINK_FACTOR` times the max seen size, the buffer shrinks to roughly
//! 1.5x the max seen size (clamped to `MIN_CAPACITY`).
//!
//! This ensures that:
//! - Normal usage keeps the buffer appropriately sized
//! - Rare large allocations don't permanently bloat memory
//! - Shrinking doesn't happen too frequently (amortized cost)

use std::fmt;
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};

// -----------------------------------------------------------------------------
// BufferParams trait
// -----------------------------------------------------------------------------

/// Configuration parameters for [`AdaptiveBuffer`] shrinking behavior.
///
/// Implement this trait on a marker type to define custom parameters:
///
/// ```
/// use crate::utils::adaptive_buffer::BufferParams;
///
/// struct MyParams;
/// impl BufferParams for MyParams {
///     const MIN_CAPACITY: usize = 1024;
///     const SHRINK_FACTOR: usize = 4;
///     const SHRINK_CHECK_INTERVAL: usize = 32;
/// }
/// ```
pub trait BufferParams {
    /// Minimum capacity / initial allocation size.
    const MIN_CAPACITY: usize;
    /// Shrink if capacity > max_seen * SHRINK_FACTOR.
    const SHRINK_FACTOR: usize;
    /// How often to check for shrinking (in number of `finish()` calls).
    const SHRINK_CHECK_INTERVAL: usize;
}

/// Default buffer parameters: MIN_CAPACITY=256, SHRINK_FACTOR=3, SHRINK_CHECK_INTERVAL=64.
#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultBufferParams;

impl BufferParams for DefaultBufferParams {
    const MIN_CAPACITY: usize = 256;
    const SHRINK_FACTOR: usize = 3;
    const SHRINK_CHECK_INTERVAL: usize = 64;
}

// -----------------------------------------------------------------------------
// AdaptiveBuffer
// -----------------------------------------------------------------------------

/// A `Vec<T>` wrapper that adaptively shrinks its capacity.
///
/// Use [`as_mut_vec`](Self::as_mut_vec) to get a mutable reference to the
/// inner buffer for writing, then call [`finish`](Self::finish) when done
/// to clear the buffer and potentially shrink it.
///
/// The `P` type parameter specifies shrinking behavior via [`BufferParams`].
/// Defaults to [`DefaultBufferParams`].
pub struct AdaptiveBuffer<T, P: BufferParams = DefaultBufferParams> {
    inner: Vec<T>,
    max_seen: usize,
    uses: usize,
    _params: PhantomData<P>,
}

#[allow(unused)]
impl<T, P: BufferParams> AdaptiveBuffer<T, P> {
    /// Creates a new buffer with `P::MIN_CAPACITY` initial capacity.
    #[inline]
    pub fn new() -> Self {
        Self {
            inner: Vec::with_capacity(P::MIN_CAPACITY),
            max_seen: P::MIN_CAPACITY,
            uses: 0,
            _params: PhantomData,
        }
    }

    /// Returns a mutable reference to the inner `Vec<T>`.
    #[inline]
    pub fn as_mut_vec(&mut self) -> &mut Vec<T> {
        &mut self.inner
    }

    /// Returns a reference to the inner `Vec<T>`.
    #[inline]
    pub fn as_vec(&self) -> &Vec<T> {
        &self.inner
    }

    /// Returns the current length of the buffer.
    #[inline]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Returns true if the buffer is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Returns the current capacity of the buffer.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.inner.capacity()
    }

    /// Clears the buffer and potentially shrinks it.
    ///
    /// Call this after each use (e.g., after serializing a message).
    /// The buffer tracks usage and periodically shrinks if capacity
    /// is much larger than needed.
    pub fn finish(&mut self) {
        self.max_seen = self.max_seen.max(self.inner.len());
        self.uses += 1;
        self.inner.clear();

        // Every N uses, check if we should shrink
        if self.uses >= P::SHRINK_CHECK_INTERVAL {
            // Shrink threshold: capacity > max_seen * SHRINK_FACTOR
            let shrink_threshold = self.max_seen.saturating_mul(P::SHRINK_FACTOR);
            if self.inner.capacity() > shrink_threshold {
                // Shrink to ~1.5x max_seen, but not below MIN_CAPACITY
                let target = (self.max_seen * 3 / 2).max(P::MIN_CAPACITY);
                self.inner.shrink_to(target);
            }
            // Reset tracking for next window
            self.max_seen = P::MIN_CAPACITY;
            self.uses = 0;
        }
    }

    /// Clears the buffer without checking for shrinking.
    #[inline]
    pub fn clear(&mut self) {
        self.inner.clear();
    }
}

impl<T, P: BufferParams> Default for AdaptiveBuffer<T, P> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Clone, P: BufferParams> Clone for AdaptiveBuffer<T, P> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            // Reset tracking state on clone — the clone starts fresh
            max_seen: self.inner.len().max(P::MIN_CAPACITY),
            uses: 0,
            _params: PhantomData,
        }
    }
}

impl<T: fmt::Debug, P: BufferParams> fmt::Debug for AdaptiveBuffer<T, P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AdaptiveBuffer")
            .field("inner", &self.inner)
            .field("max_seen", &self.max_seen)
            .field("uses", &self.uses)
            .field("MIN_CAPACITY", &P::MIN_CAPACITY)
            .field("SHRINK_FACTOR", &P::SHRINK_FACTOR)
            .field("SHRINK_CHECK_INTERVAL", &P::SHRINK_CHECK_INTERVAL)
            .finish()
    }
}

impl<T, P: BufferParams> Deref for AdaptiveBuffer<T, P> {
    type Target = [T];

    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<T, P: BufferParams> DerefMut for AdaptiveBuffer<T, P> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl<T, P: BufferParams> AsRef<[T]> for AdaptiveBuffer<T, P> {
    #[inline]
    fn as_ref(&self) -> &[T] {
        &self.inner
    }
}

impl<T, P: BufferParams> AsMut<[T]> for AdaptiveBuffer<T, P> {
    #[inline]
    fn as_mut(&mut self) -> &mut [T] {
        &mut self.inner
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Small params for fast testing of the shrink policy.
    struct TestParams;
    impl BufferParams for TestParams {
        const MIN_CAPACITY: usize = 8;
        const SHRINK_FACTOR: usize = 3;
        const SHRINK_CHECK_INTERVAL: usize = 4;
    }

    type TestBuf = AdaptiveBuffer<u8, TestParams>;

    #[test]
    fn new_has_min_capacity() {
        let buf = TestBuf::new();
        assert_eq!(buf.capacity(), TestParams::MIN_CAPACITY);
    }

    #[test]
    fn finish_clears_buffer() {
        let mut buf = TestBuf::new();
        buf.as_mut_vec().extend_from_slice(&[1, 2, 3]);
        assert_eq!(buf.len(), 3);
        buf.finish();
        assert_eq!(buf.len(), 0);
    }

    #[test]
    fn no_shrink_before_interval() {
        let mut buf = TestBuf::new();
        // Force a large allocation.
        buf.as_mut_vec().extend(std::iter::repeat(0u8).take(1024));
        let big_cap = buf.capacity();
        // Finish only once — below SHRINK_CHECK_INTERVAL (4).
        buf.finish();
        assert!(
            buf.capacity() >= big_cap,
            "capacity must not shrink before reaching SHRINK_CHECK_INTERVAL"
        );
    }

    #[test]
    fn shrinks_after_interval_with_small_usage() {
        let mut buf = TestBuf::new();
        // Fill window 1 with the large write so max_seen is big. After the
        // interval resets, subsequent small writes in window 2 will trigger
        // a shrink since capacity >> max_seen * SHRINK_FACTOR.
        for _ in 0..TestParams::SHRINK_CHECK_INTERVAL {
            buf.as_mut_vec().extend(std::iter::repeat(0u8).take(4096));
            buf.finish();
        }
        // Window 1 completed: max_seen was 4096, capacity >= 4096.
        // Now we're in window 2 — only do tiny writes.
        for _ in 0..TestParams::SHRINK_CHECK_INTERVAL {
            buf.as_mut_vec().push(1);
            buf.finish();
        }

        assert!(
            buf.capacity() < 4096,
            "capacity should have shrunk after the interval with small usage"
        );
    }

    #[test]
    fn does_not_shrink_below_min_capacity() {
        let mut buf = TestBuf::new();
        // Only empty finish calls — max_seen stays at MIN_CAPACITY.
        for _ in 0..TestParams::SHRINK_CHECK_INTERVAL * 3 {
            buf.finish();
        }
        assert!(
            buf.capacity() >= TestParams::MIN_CAPACITY,
            "capacity must never go below MIN_CAPACITY"
        );
    }

    #[test]
    fn sustained_large_usage_prevents_shrink() {
        let mut buf = TestBuf::new();
        for _ in 0..TestParams::SHRINK_CHECK_INTERVAL * 2 {
            buf.as_mut_vec().extend(std::iter::repeat(0u8).take(2048));
            buf.finish();
        }
        // Capacity should still be large enough for the sustained usage.
        // (It shouldn't have shrunk aggressively.)
        assert!(
            buf.capacity() >= 2048,
            "sustained large usage should keep capacity high"
        );
    }

    #[test]
    fn clone_resets_tracking_state() {
        let mut buf = TestBuf::new();
        buf.as_mut_vec().extend(std::iter::repeat(0u8).take(100));
        // Finish a few times to build up uses counter.
        for _ in 0..3 {
            buf.finish();
            buf.as_mut_vec().push(1);
        }

        let cloned = buf.clone();
        assert_eq!(cloned.uses, 0, "cloned buffer must reset uses counter");
    }

    #[test]
    fn default_params_reasonable() {
        let buf: AdaptiveBuffer<u8> = AdaptiveBuffer::new();
        assert_eq!(buf.capacity(), DefaultBufferParams::MIN_CAPACITY);
        assert_eq!(DefaultBufferParams::MIN_CAPACITY, 256);
        assert_eq!(DefaultBufferParams::SHRINK_FACTOR, 3);
        assert_eq!(DefaultBufferParams::SHRINK_CHECK_INTERVAL, 64);
    }
}
