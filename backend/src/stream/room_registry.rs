//! Thread-safe registry for rooms and per-user room membership indices.
//!
//! [`RoomRegistry<R, S>`] stores room handles as `Arc<R>` plus a separate user
//! index keyed by `user_id`. The registry is intentionally room-agnostic: it
//! tracks structure (`Ulid`, generations, slot occupancy) but never inspects or
//! calls into `R`. Runtime policy such as claiming, reservation lifetimes, and
//! room-specific decisions belongs in higher layers.
//!
//! # Published vs Unpublished Rooms
//!
//! A loader creates an `Arc<R>` before the registry publishes it. Until the
//! matching `Slot::Loading { incarnation }` is atomically replaced with
//! `Slot::Active { room, incarnation }`, the room is unpublished:
//! [`RoomRegistry::lookup_room`] and [`RoomRegistry::rooms`] intentionally hide
//! it. [`LoaderContext`] exists so loaders can build identity-bearing links for
//! that unpublished room without making it globally visible early.
//!
//! Identity-sensitive cleanup and finalization always compare the captured slot
//! incarnation under the same lock acquisition that performs the mutation. If a
//! room id was reused for a different incarnation, rollback paths become no-ops
//! and checked finalization returns [`ClaimCommitError::ClaimLost`] instead of
//! panicking or touching the replacement room.
//!
//! Reservation `generation` and slot `incarnation` serve different purposes:
//! generations identify reservation epochs for a specific `(user_id, room_id)`
//! claim, while incarnations identify the currently active room slot under a
//! reused `room_id`. Identity-safe mutation APIs always check incarnation under
//! the same lock acquisition as the mutation. Reservation-safe removal without a
//! room-slot identity uses generation instead.
//!
//! # Concurrency Model
//!
//! - A single `parking_lot::Mutex` protects both the room slots and the user
//!   index, so read-only snapshots observe a consistent structural state.
//! - All methods in this module are synchronous and hold the mutex only for the
//!   duration of in-memory map access.
//! - No method in this task performs I/O or awaits while holding the lock.
//!
//! # Structural Capacity vs Runtime Policy
//!
//! The `S: UserSlot` parameter controls only structural capacity for the user
//! index. `SingleSlot` encodes an exclusive one-room shape with zero overhead,
//! while `UnlimitedSlot<N>` keeps a small inline vector but imposes no hard cap.
//! Whether a user is allowed to join another room is a runtime policy layered on
//! top of this storage shape.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use ahash::RandomState;
use parking_lot::Mutex;
use smallvec::SmallVec;
use ulid::Ulid;

/// Errors returned by room-registry loading and claiming operations.
///
/// # Invariants
///
/// - Variants are structured so callers can distinguish contention, claim loss,
///   reservation mismatches, loader failure, and missing-room conditions without
///   string matching.
/// - `LoadFailed` preserves the original loader error as the source.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    /// Another task is already loading the requested room id.
    #[error("room {room_id} is already loading")]
    RoomLoading { room_id: Ulid },

    /// The user's structural slot is already full for a different room.
    #[error("user {user_id} has reached the structural room limit {max:?}")]
    MaxRoomsReached { user_id: i32, max: Option<usize> },

    /// The requested user claim conflicts with the current structural index.
    #[error("user {user_id} already holds a conflicting claim for room {room_id}")]
    AlreadyClaimed { room_id: Ulid, user_id: i32 },

    /// The user does not currently hold a reservation for this room.
    #[error("user {user_id} does not have a reservation for room {room_id}")]
    ReservationNotFound { room_id: Ulid, user_id: i32 },

    /// The user already holds a live claim for this room.
    #[error("user {user_id} is already live in room {room_id}")]
    AlreadyLive { room_id: Ulid, user_id: i32 },

    /// The caller used a stale reservation generation for this room.
    #[error(
        "user {user_id} used reservation generation {actual} for room {room_id}, expected {expected}"
    )]
    GenerationMismatch {
        room_id: Ulid,
        user_id: i32,
        expected: u64,
        actual: u64,
    },

    /// The user already holds a reservation for this room and must claim it explicitly.
    #[error("user {user_id} already has reservation generation {generation} for room {room_id}")]
    UserReserved {
        room_id: Ulid,
        user_id: i32,
        generation: u64,
    },

    /// The loader failed before publication.
    #[error("loader failed for room {room_id}")]
    LoadFailed {
        room_id: Ulid,
        user_id: Option<i32>,
        #[source]
        source: anyhow::Error,
    },

    /// Loading finished, but the captured loading slot or claim no longer matched.
    #[error("loading aborted before publication for room {room_id}")]
    LoadingAborted { room_id: Ulid, user_id: Option<i32> },

    /// No published room exists for the requested id.
    #[error("room {room_id} was not found")]
    RoomNotFound { room_id: Ulid },
}

/// Identity-bearing weak link captured for a specific room incarnation.
///
/// Loaders may construct this before publication so later bridge code can prove
/// it is still talking to the same registry slot, even if the same `room_id` is
/// reused after destroy/recreate cycles.
///
/// # Invariants
///
/// - `room_id` and `incarnation` identify the slot observed when this link was created.
/// - Upgrading `registry` does not imply that slot still exists; callers must
///   re-check identity under the registry lock before mutating shared state.
#[must_use = "RegistryLink carries slot identity for later checked operations"]
pub struct RegistryLink<R: Send + Sync + 'static, S: UserSlot = SingleSlot> {
    registry: Weak<RoomRegistry<R, S>>,
    room_id: Ulid,
    incarnation: u64,
}

impl<R: Send + Sync + 'static, S: UserSlot> RegistryLink<R, S> {
    fn new(registry: Weak<RoomRegistry<R, S>>, room_id: Ulid, incarnation: u64) -> Self {
        Self {
            registry,
            room_id,
            incarnation,
        }
    }

    /// Return the captured room id.
    #[must_use]
    pub fn room_id(&self) -> Ulid {
        self.room_id
    }

    /// Return the captured slot incarnation.
    #[must_use]
    pub fn incarnation(&self) -> u64 {
        self.incarnation
    }

    /// Return the captured weak registry handle.
    #[must_use]
    pub fn registry(&self) -> Weak<RoomRegistry<R, S>> {
        self.registry.clone()
    }
}

/// Context passed into room loaders before publication.
///
/// The room created by the loader is still unpublished while this context is in
/// scope. Callers may use it only to build identity-bearing bridges such as a
/// [`RegistryLink`] for the captured `(room_id, incarnation)` pair. The loader
/// must not assume the room is globally visible yet, and later publication may
/// still abort if the loading slot or structural claim was lost.
///
/// The fields remain public because the Task 2 API exposes them directly. When
/// [`RoomRegistry::ensure_room`] or [`RoomRegistry::ensure_and_claim`] supplies a
/// `LoaderContext`, these values were captured from that invocation's exact
/// `Slot::Loading`. Callers should treat them as observational loader inputs,
/// not as proof that publication or finalization will later succeed.
///
/// # Invariants
///
/// - When constructed by [`RoomRegistry`], `room_id` and `incarnation` were
///   captured from the exact `Slot::Loading` installed for that loader invocation.
/// - `registry` is weak so loader-owned helpers do not keep the registry alive.
pub struct LoaderContext<R: Send + Sync + 'static, S: UserSlot> {
    /// Room id currently being loaded.
    pub room_id: Ulid,
    /// Slot incarnation captured when `Slot::Loading` was installed.
    pub incarnation: u64,
    /// Weak handle back to the registry for identity-bearing helper construction.
    pub registry: Weak<RoomRegistry<R, S>>,
}

impl<R: Send + Sync + 'static, S: UserSlot> LoaderContext<R, S> {
    /// Create a [`RegistryLink`] for this unpublished room incarnation.
    #[must_use]
    pub fn make_link(&self) -> RegistryLink<R, S> {
        RegistryLink::new(self.registry.clone(), self.room_id, self.incarnation)
    }
}

/// Finalization failed because the captured claim no longer matched registry state.
///
/// `ClaimLost` is the checked outcome for stale, destroyed, or otherwise lost
/// claims. Callers must treat it as failed activation, undo any room-local
/// state they already made visible, and must not report success upward.
///
/// # Invariants
///
/// - `ClaimLost` reports identity mismatch or registry disappearance as a
///   normal fallible outcome, never as a panic.
/// - `user_id == None` means the failure came from a room-only finalization
///   path rather than a user-owned claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ClaimCommitError {
    /// The room slot or indexed claim changed before finalization completed.
    ///
    /// This includes the public `commit()` mismatch cases where:
    /// - the weak registry handle no longer upgrades,
    /// - `room_id` no longer points at an active slot with the captured incarnation,
    /// - the caller's indexed live claim is gone or no longer live.
    #[error("claim lost before finalization for room {room_id}")]
    ClaimLost { room_id: Ulid, user_id: Option<i32> },
}

/// Result returned by authoritative room destruction.
///
/// # Invariants
///
/// - `users` contains every user whose structural index entry for the destroyed
///   `room_id` was removed in the same lock scope as the slot removal.
/// - `room == None` means the destroyed slot was still loading.
/// - `room == Some(_)` means the destroyed slot was active and returns the exact
///   `Arc<R>` removed from the registry.
#[must_use = "destroy results report which room handle and user claims were removed"]
#[derive(Debug)]
pub struct DestroyResult<R: Send + Sync + 'static> {
    /// Removed room handle, if the slot was active.
    pub room: Option<Arc<R>>,
    /// User ids whose index entries for the room were removed.
    pub users: Vec<i32>,
}

#[derive(Debug)]
enum ClaimGuardKind {
    FreshJoin {
        owns_loading_slot: bool,
        published: bool,
    },
    Rejoin {
        generation: u64,
    },
}

/// RAII guard for unpublished or unfinalized registry claim state.
///
/// A guard is created before awaiting the loader and stays armed until
/// [`commit`](Self::commit) succeeds. Dropping an armed guard rolls back only the
/// slot incarnation captured at construction time; if the `room_id` now points to
/// a different incarnation, rollback becomes a no-op instead of mutating foreign
/// state.
///
/// Callers that receive a `ClaimGuard` from [`RoomRegistry::ensure_and_claim`]
/// must call [`commit`](Self::commit) only after all room-local activation work
/// has succeeded and after releasing any room lock. Failed finalization means the
/// claim was lost: the caller must treat the join as failed, undo room-local
/// activation, and must not report success.
///
/// # Invariants
///
/// - `incarnation` is the slot identity captured when the guard was created.
/// - Armed drop and `commit()` only mutate registry state while holding the
///   registry lock and only when the current slot still matches `incarnation`.
/// - `committed == true` means drop is a no-op.
#[must_use = "dropping without commit() rolls back uncommitted registry state"]
#[derive(Debug)]
pub struct ClaimGuard<R: Send + Sync + 'static, S: UserSlot = SingleSlot> {
    registry: Weak<RoomRegistry<R, S>>,
    room_id: Ulid,
    incarnation: u64,
    user_id: Option<i32>,
    kind: ClaimGuardKind,
    committed: bool,
}

impl<R: Send + Sync + 'static, S: UserSlot> ClaimGuard<R, S> {
    fn new(
        registry: Weak<RoomRegistry<R, S>>,
        room_id: Ulid,
        incarnation: u64,
        user_id: Option<i32>,
        kind: ClaimGuardKind,
    ) -> Self {
        Self {
            registry,
            room_id,
            incarnation,
            user_id,
            kind,
            committed: false,
        }
    }

    fn mark_published(&mut self) {
        if let ClaimGuardKind::FreshJoin { published, .. } = &mut self.kind {
            *published = true;
        }
    }

    /// Mark the guard as successfully finalized.
    ///
    /// This is the checked finalization seam for caller-owned claims.
    /// `commit()` must be called with no room lock held, and an armed guard must
    /// never be dropped while a room lock is held.
    ///
    /// # Errors
    ///
    /// Returns [`ClaimCommitError::ClaimLost`] if, under the registry lock, the
    /// weak registry handle no longer upgrades, the published room slot no
    /// longer matches the captured incarnation, or the indexed live claim is
    /// gone. Callers must treat `ClaimLost` as failed finalization, undo any
    /// room-local activation they already performed, and must not report join
    /// success after destroy, replacement, or stale-claim loss.
    pub fn commit(&mut self) -> Result<(), ClaimCommitError> {
        if self.committed {
            return Ok(());
        }

        let Some(registry) = self.registry.upgrade() else {
            return Err(ClaimCommitError::ClaimLost {
                room_id: self.room_id,
                user_id: self.user_id,
            });
        };

        let inner = registry.inner.lock();
        if !RoomRegistry::<R, S>::active_slot_matches(&inner, self.room_id, self.incarnation) {
            return Err(ClaimCommitError::ClaimLost {
                room_id: self.room_id,
                user_id: self.user_id,
            });
        }

        if let Some(user_id) = self.user_id {
            let live_claim_still_exists = inner
                .index
                .get(&user_id)
                .and_then(|slot| slot.find(self.room_id))
                .is_some_and(|entry| entry.state == EntryState::Live);
            if !live_claim_still_exists {
                return Err(ClaimCommitError::ClaimLost {
                    room_id: self.room_id,
                    user_id: self.user_id,
                });
            }
        }

        drop(inner);
        self.committed = true;
        Ok(())
    }

    /// Return the guarded room id.
    #[must_use]
    pub fn room_id(&self) -> Ulid {
        self.room_id
    }

    /// Return the guarded user id, if this guard tracks a user claim.
    #[must_use]
    pub fn user_id(&self) -> Option<i32> {
        self.user_id
    }

    /// Return the captured room-slot incarnation.
    #[must_use]
    pub fn incarnation(&self) -> u64 {
        self.incarnation
    }
}

impl<R: Send + Sync + 'static, S: UserSlot> Drop for ClaimGuard<R, S> {
    fn drop(&mut self) {
        if self.committed {
            return;
        }

        let Some(registry) = self.registry.upgrade() else {
            return;
        };

        let mut inner = registry.inner.lock();
        match self.kind {
            ClaimGuardKind::FreshJoin {
                owns_loading_slot,
                published,
            } => {
                if let Some(user_id) = self.user_id {
                    let slot_absent_or_same_incarnation =
                        RoomRegistry::<R, S>::slot_absent_or_matches(
                            inner.slots.get(&self.room_id),
                            self.incarnation,
                        );
                    if slot_absent_or_same_incarnation {
                        RoomRegistry::<R, S>::remove_user_entry_locked(
                            &mut inner,
                            user_id,
                            self.room_id,
                        );
                    }
                }

                if owns_loading_slot && !published {
                    let same_loading_slot = matches!(
                        inner.slots.get(&self.room_id),
                        Some(Slot::Loading { incarnation }) if *incarnation == self.incarnation
                    );
                    if same_loading_slot {
                        inner.slots.remove(&self.room_id);
                    }
                }
            }
            ClaimGuardKind::Rejoin { generation } => {
                let Some(user_id) = self.user_id else {
                    return;
                };

                if !RoomRegistry::<R, S>::active_slot_matches(
                    &inner,
                    self.room_id,
                    self.incarnation,
                ) {
                    return;
                }

                if let Some(entry) = inner
                    .index
                    .get_mut(&user_id)
                    .and_then(|slot| slot.find_mut(self.room_id))
                {
                    if entry.state == EntryState::Live {
                        entry.state = EntryState::Reserved { generation };
                    }
                }
            }
        }
    }
}

/// Thread-safe room registry with a room table and per-user index.
///
/// The registry stores `Arc<R>` values but never inspects `R`. This keeps the
/// registry reusable across room implementations and ensures the read-only APIs
/// stay purely structural.
///
/// # Invariants
///
/// - `inner.slots` contains at most one structural slot per `room_id`.
/// - `inner.index` contains only non-empty `S` values; `S::new_with` is the
///   only constructor for occupied outer-map entries.
/// - `next_generation` and `next_incarnation` both start at `1`, leaving `0`
///   available as a sentinel for future bridge logic.
/// - `next_generation` tracks reservation epochs only; `next_incarnation`
///   tracks room-slot identity only. They must never be used interchangeably.
/// - Every reserved user entry counts toward structural capacity and must still
///   point at an active room slot.
///
/// # Lock Level: 1
///
/// `inner` is the module's only lock. No other locks are acquired while held.
pub struct RoomRegistry<R: Send + Sync + 'static, S: UserSlot = SingleSlot> {
    inner: Mutex<RegistryInner<R, S>>,
    next_generation: AtomicU64,
    next_incarnation: AtomicU64,
}

struct RegistryInner<R: Send + Sync + 'static, S: UserSlot> {
    slots: HashMap<Ulid, Slot<R>, RandomState>,
    index: HashMap<i32, S, RandomState>,
}

/// Structural state recorded in the per-user index.
///
/// `Reserved` distinguishes index entries that still count structurally for a
/// user, still consume slot capacity, and still point at the current active room
/// slot, but are not currently a live user claim.
///
/// # Invariants
///
/// - `Live` means the user is structurally present in the room, including an
///   actively joined member or a pending join still represented in the index.
/// - `Reserved { generation }` keeps reservation identity separate from room
///   slot identity: `generation` is the reservation epoch, while slot identity
///   remains the room slot's `incarnation`.
/// - Every `Reserved` entry must refer to a currently active room slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryState {
    /// The user is structurally present in the indexed room.
    ///
    /// This includes both fully joined members and pending joins that are still
    /// tracked in the user index.
    Live,
    /// The indexed room is reserved for the recorded generation.
    Reserved { generation: u64 },
}

/// Structural user-index entry returned by read-only registry queries.
///
/// This value deliberately contains only structural metadata. Callers that need
/// a room handle must resolve `room_id` separately through [`RoomRegistry::lookup_room`].
#[derive(Debug, Clone, Copy)]
pub struct UserIndexEntry {
    /// Room identifier stored in the registry.
    pub room_id: Ulid,
    /// Structural state for this room within the user's slot.
    pub state: EntryState,
}

/// Outcome of removing a room from a [`UserSlot`].
///
/// # Invariants
///
/// - `RemovedAndEmpty` means the outer user-index entry must be deleted.
/// - `Removed` means the slot still contains at least one entry.
/// - `NotFound` means the slot was unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoveResult {
    /// The requested room was not present in the slot.
    NotFound,
    /// The room was removed and the slot still contains other entries.
    Removed,
    /// The room was removed and the slot is now structurally empty.
    RemovedAndEmpty,
}

/// Structural storage for the per-user room index.
///
/// Concrete slot types encode structural capacity only. They must remain purely
/// synchronous and must not acquire locks or perform I/O.
///
/// # Invariants
///
/// - Each occupied slot contains at least one [`UserIndexEntry`].
/// - Each `(user_id, room_id)` pair appears at most once within a slot.
/// - [`UserSlot::insert`] returns `false` only for structural-capacity reasons.
pub trait UserSlot: Send + Sync + Sized + 'static {
    /// Fixed structural capacity for this slot, if any.
    const CAPACITY: Option<usize>;

    /// Create a new occupied slot from the first entry.
    fn new_with(entry: UserIndexEntry) -> Self;

    /// Number of entries currently stored in the slot.
    fn len(&self) -> usize;

    /// Whether the slot is structurally empty.
    fn is_empty(&self) -> bool;

    /// Find the entry for `room_id`.
    fn find(&self, room_id: Ulid) -> Option<&UserIndexEntry>;

    /// Find the mutable entry for `room_id`.
    fn find_mut(&mut self, room_id: Ulid) -> Option<&mut UserIndexEntry>;

    /// Insert an additional entry.
    ///
    /// Returns `false` only when the slot's structural capacity is full.
    fn insert(&mut self, entry: UserIndexEntry) -> bool;

    /// Remove the entry for `room_id`.
    fn remove(&mut self, room_id: Ulid) -> RemoveResult;

    /// Visit every stored entry in the slot.
    fn for_each(&self, f: impl FnMut(&UserIndexEntry));
}

/// One-entry user slot with zero overhead over [`UserIndexEntry`].
///
/// Use this for exclusive registries where a user may occupy only one structural
/// slot at a time.
///
/// # Invariants
///
/// - A `SingleSlot` always contains exactly one [`UserIndexEntry`].
/// - `is_empty()` is always `false`.
/// - Removing the stored room always yields [`RemoveResult::RemovedAndEmpty`].
#[derive(Debug, Clone)]
#[repr(transparent)]
pub struct SingleSlot(UserIndexEntry);

/// Multi-entry user slot backed by a [`SmallVec`].
///
/// `N` controls inline storage only. The slot remains structurally unlimited and
/// spills to the heap when more than `N` entries are stored.
///
/// # Invariants
///
/// - `UnlimitedSlot` is created only via [`UserSlot::new_with`], so occupied
///   outer-map entries start non-empty.
/// - Each stored `room_id` is unique within the slot.
/// - `CAPACITY` is always `None`; runtime policy must enforce any user limits.
#[derive(Debug, Clone)]
pub struct UnlimitedSlot<const N: usize = 4>(SmallVec<[UserIndexEntry; N]>);

enum Slot<R: Send + Sync + 'static> {
    Loading { incarnation: u64 },
    Active { room: Arc<R>, incarnation: u64 },
}

impl<R: Send + Sync + 'static, S: UserSlot> RoomRegistry<R, S> {
    fn next_generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::Relaxed)
    }

    fn next_incarnation(&self) -> u64 {
        self.next_incarnation.fetch_add(1, Ordering::Relaxed)
    }

    fn max_rooms_reached(user_id: i32) -> RegistryError {
        RegistryError::MaxRoomsReached {
            user_id,
            max: S::CAPACITY,
        }
    }

    fn active_slot_matches(inner: &RegistryInner<R, S>, room_id: Ulid, incarnation: u64) -> bool {
        matches!(
            inner.slots.get(&room_id),
            Some(Slot::Active {
                incarnation: current,
                ..
            }) if *current == incarnation
        )
    }

    fn active_room_locked(inner: &RegistryInner<R, S>, room_id: Ulid) -> Option<(Arc<R>, u64)> {
        match inner.slots.get(&room_id) {
            Some(Slot::Active { room, incarnation }) => Some((Arc::clone(room), *incarnation)),
            Some(Slot::Loading { .. }) | None => None,
        }
    }

    fn slot_absent_or_matches(slot: Option<&Slot<R>>, incarnation: u64) -> bool {
        match slot {
            None => true,
            Some(Slot::Loading {
                incarnation: current,
            })
            | Some(Slot::Active {
                incarnation: current,
                ..
            }) => *current == incarnation,
        }
    }

    fn remove_user_entry_locked(
        inner: &mut RegistryInner<R, S>,
        user_id: i32,
        room_id: Ulid,
    ) -> RemoveResult {
        use std::collections::hash_map::Entry;

        match inner.index.entry(user_id) {
            Entry::Occupied(mut occupied) => {
                let result = occupied.get_mut().remove(room_id);
                if result == RemoveResult::RemovedAndEmpty {
                    occupied.remove();
                }
                result
            }
            Entry::Vacant(_) => RemoveResult::NotFound,
        }
    }

    fn remove_room_index_entries_locked(
        inner: &mut RegistryInner<R, S>,
        room_id: Ulid,
    ) -> Vec<i32> {
        let mut users = Vec::new();
        inner
            .index
            .retain(|user_id, slot| match slot.remove(room_id) {
                RemoveResult::NotFound => true,
                RemoveResult::Removed => {
                    users.push(*user_id);
                    true
                }
                RemoveResult::RemovedAndEmpty => {
                    users.push(*user_id);
                    false
                }
            });
        users.sort_unstable();
        users
    }

    fn destroy_locked(inner: &mut RegistryInner<R, S>, room_id: Ulid) -> Option<DestroyResult<R>> {
        let slot = inner.slots.remove(&room_id)?;
        let users = Self::remove_room_index_entries_locked(inner, room_id);
        let room = match slot {
            Slot::Loading { .. } => None,
            Slot::Active { room, .. } => Some(room),
        };
        Some(DestroyResult { room, users })
    }

    fn claim_active_room_locked(
        self: &Arc<Self>,
        inner: &mut RegistryInner<R, S>,
        user_id: i32,
        room_id: Ulid,
        room: Arc<R>,
        incarnation: u64,
    ) -> Result<(Arc<R>, ClaimGuard<R, S>), RegistryError> {
        use std::collections::hash_map::Entry;

        let kind = match inner.index.entry(user_id) {
            Entry::Occupied(mut occupied) => match occupied.get_mut().find_mut(room_id) {
                Some(entry) => match entry.state {
                    EntryState::Live => {
                        return Err(RegistryError::AlreadyClaimed { room_id, user_id });
                    }
                    EntryState::Reserved { generation } => {
                        return Err(RegistryError::UserReserved {
                            room_id,
                            user_id,
                            generation,
                        });
                    }
                },
                None => {
                    if !occupied.get_mut().insert(UserIndexEntry {
                        room_id,
                        state: EntryState::Live,
                    }) {
                        return Err(Self::max_rooms_reached(user_id));
                    }
                    ClaimGuardKind::FreshJoin {
                        owns_loading_slot: false,
                        published: true,
                    }
                }
            },
            Entry::Vacant(vacant) => {
                vacant.insert(S::new_with(UserIndexEntry {
                    room_id,
                    state: EntryState::Live,
                }));
                ClaimGuardKind::FreshJoin {
                    owns_loading_slot: false,
                    published: true,
                }
            }
        };

        Ok((
            room,
            ClaimGuard::new(
                Arc::downgrade(self),
                room_id,
                incarnation,
                Some(user_id),
                kind,
            ),
        ))
    }

    fn prepare_loading_claim_locked(
        self: &Arc<Self>,
        inner: &mut RegistryInner<R, S>,
        user_id: i32,
        room_id: Ulid,
    ) -> Result<ClaimGuard<R, S>, RegistryError> {
        use std::collections::hash_map::Entry;

        let kind = match inner.index.entry(user_id) {
            Entry::Occupied(mut occupied) => match occupied.get_mut().find_mut(room_id) {
                Some(entry) => match entry.state {
                    EntryState::Live => {
                        return Err(RegistryError::AlreadyClaimed { room_id, user_id });
                    }
                    EntryState::Reserved { generation } => {
                        return Err(RegistryError::UserReserved {
                            room_id,
                            user_id,
                            generation,
                        });
                    }
                },
                None => {
                    if !occupied.get_mut().insert(UserIndexEntry {
                        room_id,
                        state: EntryState::Live,
                    }) {
                        return Err(Self::max_rooms_reached(user_id));
                    }
                    ClaimGuardKind::FreshJoin {
                        owns_loading_slot: true,
                        published: false,
                    }
                }
            },
            Entry::Vacant(vacant) => {
                vacant.insert(S::new_with(UserIndexEntry {
                    room_id,
                    state: EntryState::Live,
                }));
                ClaimGuardKind::FreshJoin {
                    owns_loading_slot: true,
                    published: false,
                }
            }
        };

        let incarnation = self.next_incarnation();
        inner.slots.insert(room_id, Slot::Loading { incarnation });
        Ok(ClaimGuard::new(
            Arc::downgrade(self),
            room_id,
            incarnation,
            Some(user_id),
            kind,
        ))
    }

    fn prepare_loading_room_guard_locked(
        self: &Arc<Self>,
        inner: &mut RegistryInner<R, S>,
        room_id: Ulid,
    ) -> ClaimGuard<R, S> {
        let incarnation = self.next_incarnation();
        inner.slots.insert(room_id, Slot::Loading { incarnation });
        ClaimGuard::new(
            Arc::downgrade(self),
            room_id,
            incarnation,
            None,
            ClaimGuardKind::FreshJoin {
                owns_loading_slot: true,
                published: false,
            },
        )
    }

    fn finalize_loading_claim_locked(
        inner: &mut RegistryInner<R, S>,
        user_id: i32,
        room_id: Ulid,
        kind: &ClaimGuardKind,
    ) -> bool {
        match kind {
            ClaimGuardKind::FreshJoin { .. } => inner
                .index
                .get(&user_id)
                .and_then(|slot| slot.find(room_id))
                .is_some_and(|entry| entry.state == EntryState::Live),
            ClaimGuardKind::Rejoin { generation } => {
                let Some(entry) = inner
                    .index
                    .get_mut(&user_id)
                    .and_then(|slot| slot.find_mut(room_id))
                else {
                    return false;
                };

                match entry.state {
                    EntryState::Reserved {
                        generation: current,
                    } if current == *generation => {
                        entry.state = EntryState::Live;
                        true
                    }
                    _ => false,
                }
            }
        }
    }

    /// Create a new shared registry.
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(RegistryInner {
                slots: HashMap::default(),
                index: HashMap::default(),
            }),
            next_generation: AtomicU64::new(1),
            next_incarnation: AtomicU64::new(1),
        })
    }

    /// Return a cloned structural slot for `user_id`.
    ///
    /// The returned value contains only [`UserIndexEntry`] data. This method
    /// never resolves `room_id` values into `Arc<R>` handles.
    #[must_use]
    pub fn lookup_user(&self, user_id: i32) -> Option<S>
    where
        S: Clone,
    {
        self.inner.lock().index.get(&user_id).cloned()
    }

    /// Return the active room handle for `room_id`.
    ///
    /// Loading slots are intentionally hidden from this read-only API.
    #[must_use]
    pub fn lookup_room(&self, room_id: Ulid) -> Option<Arc<R>> {
        match self.inner.lock().slots.get(&room_id) {
            Some(Slot::Active { room, .. }) => Some(Arc::clone(room)),
            Some(Slot::Loading { .. }) | None => None,
        }
    }

    /// Snapshot all active rooms in the registry.
    ///
    /// Loading slots are skipped.
    #[must_use]
    pub fn rooms(&self) -> Vec<(Ulid, Arc<R>)> {
        self.inner
            .lock()
            .slots
            .iter()
            .filter_map(|(room_id, slot)| match slot {
                Slot::Loading { .. } => None,
                Slot::Active { room, .. } => Some((*room_id, Arc::clone(room))),
            })
            .collect()
    }

    /// Count active rooms in the registry.
    #[must_use]
    pub fn room_count(&self) -> usize {
        self.inner
            .lock()
            .slots
            .values()
            .filter(|slot| matches!(slot, Slot::Active { .. }))
            .count()
    }

    /// Count structural room entries for `user_id`.
    ///
    /// Both [`EntryState::Live`] and [`EntryState::Reserved`] entries count.
    #[must_use]
    pub fn user_room_count(&self, user_id: i32) -> usize {
        self.inner
            .lock()
            .index
            .get(&user_id)
            .map_or(0, |slot| slot.len())
    }

    /// Convert a live claim into a reservation for the current room.
    ///
    /// This method is unchecked: it assumes the caller already knows the active
    /// room slot for `room_id` is still the intended current incarnation.
    /// Stale-capable callers must prefer
    /// [`RoomRegistry::mark_reserved_if_matches`].
    ///
    /// Returns the new reservation generation when transitioning `Live` to
    /// `Reserved`, the existing generation when the entry is already reserved,
    /// and `None` when the user has no entry for `room_id` or when the room no
    /// longer has an active slot for that unchecked caller path.
    #[must_use]
    pub fn mark_reserved(&self, user_id: i32, room_id: Ulid) -> Option<u64> {
        let mut inner = self.inner.lock();
        let room_is_active = matches!(inner.slots.get(&room_id), Some(Slot::Active { .. }));
        let entry = inner
            .index
            .get_mut(&user_id)
            .and_then(|slot| slot.find_mut(room_id))?;

        if !room_is_active {
            debug_assert!(
                false,
                "mark_reserved requires room {room_id} to remain active while a reservation exists"
            );
            return None;
        }

        match entry.state {
            EntryState::Live => {
                let generation = self.next_generation();
                entry.state = EntryState::Reserved { generation };
                Some(generation)
            }
            EntryState::Reserved { generation } => Some(generation),
        }
    }

    /// Claim an existing reservation without invoking a loader.
    ///
    /// This is the reservation-aware rejoin path. On success it promotes the
    /// matching reservation back to [`EntryState::Live`], returns the already
    /// published `Arc<R>`, and arms a [`ClaimGuard`] whose rollback path will
    /// restore the same reservation generation only if the same room-slot
    /// incarnation still exists.
    ///
    /// A successful `claim_reserved()` is still provisional. The returned value
    /// is `(Arc<R>, ClaimGuard)`, not a completed rejoin. Callers must finish
    /// all room-local reactivation work before calling [`ClaimGuard::commit`].
    /// Dropping the guard before `commit()` rolls the structural claim back to
    /// `Reserved { generation }`, and `commit()` can still fail with
    /// [`ClaimCommitError::ClaimLost`] after `claim_reserved()` itself already
    /// succeeded if destroy or slot replacement invalidates that captured
    /// incarnation.
    ///
    /// `generation` is the reservation epoch for this `(user_id, room_id)`
    /// entry. It is distinct from the room slot's `incarnation`, which remains
    /// the identity token for stale-safe mutation and finalization.
    ///
    /// # Errors
    ///
    /// - [`RegistryError::ReservationNotFound`] if the user has no entry for `room_id`.
    /// - [`RegistryError::AlreadyLive`] if the user's entry is already live.
    /// - [`RegistryError::GenerationMismatch`] if `generation` is stale.
    /// - [`RegistryError::RoomNotFound`] if the reservation no longer points at
    ///   an active room slot. This is a defensive invariant-violation path.
    pub fn claim_reserved(
        self: &Arc<Self>,
        user_id: i32,
        room_id: Ulid,
        generation: u64,
    ) -> Result<(Arc<R>, ClaimGuard<R, S>), RegistryError> {
        let mut inner = self.inner.lock();
        match inner
            .index
            .get(&user_id)
            .and_then(|slot| slot.find(room_id))
            .map(|entry| entry.state)
        {
            None => return Err(RegistryError::ReservationNotFound { room_id, user_id }),
            Some(EntryState::Live) => return Err(RegistryError::AlreadyLive { room_id, user_id }),
            Some(EntryState::Reserved {
                generation: expected,
            }) if expected != generation => {
                return Err(RegistryError::GenerationMismatch {
                    room_id,
                    user_id,
                    expected,
                    actual: generation,
                });
            }
            Some(EntryState::Reserved { .. }) => {}
        }

        let Some((room, incarnation)) = Self::active_room_locked(&inner, room_id) else {
            debug_assert!(
                false,
                "reserved entry for room {room_id} must point at an active slot before claim_reserved"
            );
            return Err(RegistryError::RoomNotFound { room_id });
        };

        let entry = inner
            .index
            .get_mut(&user_id)
            .and_then(|slot| slot.find_mut(room_id))
            .expect("claim_reserved reuses the same locked reservation entry it just validated");
        debug_assert!(
            entry.state == EntryState::Reserved { generation },
            "claim_reserved must promote only the matching reserved generation under one lock"
        );
        entry.state = EntryState::Live;

        Ok((
            room,
            ClaimGuard::new(
                Arc::downgrade(self),
                room_id,
                incarnation,
                Some(user_id),
                ClaimGuardKind::Rejoin { generation },
            ),
        ))
    }

    /// Remove a reservation only when `generation` still matches.
    ///
    /// This is generation-safe even across destroy and later room-id reuse,
    /// because a replacement reservation receives a fresh generation before it
    /// can be removed.
    ///
    /// Returns `true` only when `(user_id, room_id)` currently exists as
    /// `Reserved { generation }` with the exact supplied generation. Returns
    /// `false` for a missing entry, a live entry, or a stale generation after
    /// destroy plus room-id reuse.
    #[must_use]
    pub fn leave_if_reserved(&self, user_id: i32, room_id: Ulid, generation: u64) -> bool {
        let mut inner = self.inner.lock();
        let matches_generation = inner
            .index
            .get(&user_id)
            .and_then(|slot| slot.find(room_id))
            .is_some_and(|entry| entry.state == EntryState::Reserved { generation });
        matches_generation
            && !matches!(
                Self::remove_user_entry_locked(&mut inner, user_id, room_id),
                RemoveResult::NotFound
            )
    }

    /// Remove a user entry only when the current active room slot matches `incarnation`.
    ///
    /// This is the identity-safe removal path for stale-capable callers that
    /// captured a room-slot incarnation earlier. The identity check and removal
    /// happen under the same registry lock acquisition.
    ///
    /// Returns `true` only when the current slot at `room_id` is active with the
    /// exact supplied incarnation and the user entry exists. Returns `false` for
    /// a missing user entry, an absent room slot, a loading slot, or a stale or
    /// mismatched incarnation.
    #[must_use]
    pub fn leave_if_matches(&self, user_id: i32, room_id: Ulid, incarnation: u64) -> bool {
        let mut inner = self.inner.lock();
        if !Self::active_slot_matches(&inner, room_id, incarnation) {
            return false;
        }

        !matches!(
            Self::remove_user_entry_locked(&mut inner, user_id, room_id),
            RemoveResult::NotFound
        )
    }

    /// Convert a live claim into a reservation only when `incarnation` still matches.
    ///
    /// This is the identity-safe reservation path for stale-capable callers.
    /// `generation` remains the reservation epoch; `incarnation` remains the
    /// room-slot identity token used to prove the caller is still mutating the
    /// same active slot.
    ///
    /// Returns `Some(new_generation)` when transitioning `Live` to
    /// `Reserved`, `Some(existing_generation)` when the entry is already
    /// reserved for the same current incarnation, and `None` for a missing user
    /// entry, an absent or loading room slot, or a stale or mismatched
    /// incarnation.
    #[must_use]
    pub fn mark_reserved_if_matches(
        &self,
        user_id: i32,
        room_id: Ulid,
        incarnation: u64,
    ) -> Option<u64> {
        let mut inner = self.inner.lock();
        if !Self::active_slot_matches(&inner, room_id, incarnation) {
            return None;
        }

        let entry = inner
            .index
            .get_mut(&user_id)
            .and_then(|slot| slot.find_mut(room_id))?;
        match entry.state {
            EntryState::Live => {
                let generation = self.next_generation();
                entry.state = EntryState::Reserved { generation };
                Some(generation)
            }
            EntryState::Reserved { generation } => Some(generation),
        }
    }

    /// Remove a user's structural index entry for `room_id`.
    ///
    /// This method is unchecked: it mutates only the per-user index and does not
    /// verify room-slot identity, room state, or caller freshness. Call it only
    /// from authoritative cleanup paths that know the `(user_id, room_id)` pair
    /// is still current. Stale-capable callers must not use this method to infer
    /// liveness; they need an identity-safe `_if_matches` style API instead.
    #[must_use]
    pub fn leave(&self, user_id: i32, room_id: Ulid) -> bool {
        let mut inner = self.inner.lock();
        !matches!(
            Self::remove_user_entry_locked(&mut inner, user_id, room_id),
            RemoveResult::NotFound
        )
    }

    /// Authoritatively remove a room slot and every matching user index entry.
    ///
    /// This method is unchecked: it destroys whatever slot currently lives at
    /// `room_id` without proving the caller still owns that slot's identity.
    /// Call it only from authoritative teardown paths that have already decided
    /// the current room id must be removed. Stale-capable callers must prefer
    /// [`RoomRegistry::destroy_if_matches`] so destroy/recreate races cannot tear
    /// down a replacement incarnation.
    #[must_use]
    pub fn destroy(&self, room_id: Ulid) -> Option<DestroyResult<R>> {
        Self::destroy_locked(&mut self.inner.lock(), room_id)
    }

    /// Destroy the active room only if the current slot matches `incarnation`.
    ///
    /// This checked variant is the identity-safe destroy path for stale-capable
    /// callers. It performs the active-slot identity check and the destructive
    /// mutation under the same registry lock acquisition, so a destroy/recreate
    /// race cannot remove a replacement incarnation. It destroys only
    /// `Slot::Active` entries: `Loading` slots are ignored even when their
    /// incarnation matches. Returns `None` when `room_id` is absent, when the
    /// current slot is still loading, or when the active slot's incarnation does
    /// not match `incarnation`.
    #[must_use]
    pub fn destroy_if_matches(&self, room_id: Ulid, incarnation: u64) -> Option<DestroyResult<R>> {
        let mut inner = self.inner.lock();
        match inner.slots.get(&room_id) {
            Some(Slot::Active {
                incarnation: current,
                ..
            }) if *current == incarnation => Self::destroy_locked(&mut inner, room_id),
            Some(Slot::Loading { .. }) | Some(Slot::Active { .. }) | None => None,
        }
    }

    /// Ensure a room exists and return the published room handle.
    ///
    /// If the room is absent, this method installs a `Slot::Loading` entry,
    /// invokes `loader`, then publishes the returned `Arc<R>` only if the same
    /// loading slot still exists. The loader-created room remains unpublished
    /// until that final checked publication step.
    ///
    /// # Cancel Safety
    ///
    /// This method has exactly one `.await`: `loader(ctx).await`. If the future
    /// is cancelled during that await, the internal guard rolls back the loading
    /// slot before drop returns.
    ///
    /// # Errors
    ///
    /// - [`RegistryError::RoomLoading`] if another task is already loading `room_id`.
    /// - [`RegistryError::LoadFailed`] if the loader returns an error.
    /// - [`RegistryError::LoadingAborted`] if the captured loading slot vanished
    ///   or was replaced before publication or finalization.
    pub async fn ensure_room<F, Fut>(
        self: &Arc<Self>,
        room_id: Ulid,
        loader: F,
    ) -> Result<Arc<R>, RegistryError>
    where
        F: FnOnce(LoaderContext<R, S>) -> Fut,
        Fut: Future<Output = Result<Arc<R>, anyhow::Error>>,
    {
        let mut guard = {
            let mut inner = self.inner.lock();
            match inner.slots.get(&room_id) {
                Some(Slot::Active { room, .. }) => return Ok(Arc::clone(room)),
                Some(Slot::Loading { .. }) => return Err(RegistryError::RoomLoading { room_id }),
                None => self.prepare_loading_room_guard_locked(&mut inner, room_id),
            }
        };

        let ctx = LoaderContext {
            room_id,
            incarnation: guard.incarnation(),
            registry: Arc::downgrade(self),
        };
        let room = match loader(ctx).await {
            Ok(room) => room,
            Err(source) => {
                return Err(RegistryError::LoadFailed {
                    room_id,
                    user_id: None,
                    source,
                });
            }
        };

        {
            let mut inner = self.inner.lock();
            let same_loading_slot = matches!(
                inner.slots.get(&room_id),
                Some(Slot::Loading { incarnation }) if *incarnation == guard.incarnation()
            );
            if !same_loading_slot {
                return Err(RegistryError::LoadingAborted {
                    room_id,
                    user_id: None,
                });
            }

            inner.slots.insert(
                room_id,
                Slot::Active {
                    room: Arc::clone(&room),
                    incarnation: guard.incarnation(),
                },
            );
            guard.mark_published();
        }

        if guard.commit().is_err() {
            return Err(RegistryError::LoadingAborted {
                room_id,
                user_id: None,
            });
        }

        Ok(room)
    }

    /// Ensure a room exists, then return the room plus a caller-owned claim guard.
    ///
    /// If the room already exists, this method claims the active slot without
    /// invoking `loader`. If the room is absent, it installs `Slot::Loading`,
    /// invokes `loader`, then publishes only if the same loading slot still
    /// exists. The returned [`ClaimGuard`] protects the caller's claim until the
    /// caller finishes room-local activation and calls [`ClaimGuard::commit`].
    ///
    /// # Cancel Safety
    ///
    /// This method has exactly one `.await`: `loader(ctx).await`. If the future
    /// is cancelled during that await, the armed guard rolls back the loading
    /// slot and any provisional fresh-join index entry.
    ///
    /// # Errors
    ///
    /// - [`RegistryError::RoomLoading`] if another task is already loading `room_id`.
    /// - [`RegistryError::MaxRoomsReached`] if the user's structural slot is full
    ///   for a different room.
    /// - [`RegistryError::AlreadyClaimed`] if the user's structural slot cannot
    ///   accept this claim or the same room is already live for that user.
    /// - [`RegistryError::UserReserved`] if the user already has a reservation
    ///   for `room_id`; callers must use [`RoomRegistry::claim_reserved`]
    ///   instead of starting a new ensured claim.
    /// - [`RegistryError::LoadFailed`] if the loader returns an error.
    /// - [`RegistryError::LoadingAborted`] if the loading slot or claim changed
    ///   before publication completed.
    pub async fn ensure_and_claim<F, Fut>(
        self: &Arc<Self>,
        user_id: i32,
        room_id: Ulid,
        loader: F,
    ) -> Result<(Arc<R>, ClaimGuard<R, S>), RegistryError>
    where
        F: FnOnce(LoaderContext<R, S>) -> Fut,
        Fut: Future<Output = Result<Arc<R>, anyhow::Error>>,
    {
        let mut guard = {
            let mut inner = self.inner.lock();
            match inner
                .index
                .get(&user_id)
                .and_then(|slot| slot.find(room_id))
                .map(|entry| entry.state)
            {
                Some(EntryState::Live) => {
                    return Err(RegistryError::AlreadyClaimed { room_id, user_id });
                }
                Some(EntryState::Reserved { generation }) => {
                    return Err(RegistryError::UserReserved {
                        room_id,
                        user_id,
                        generation,
                    });
                }
                None => {}
            }

            let existing_room = match inner.slots.get(&room_id) {
                Some(Slot::Active { room, incarnation }) => Some((Arc::clone(room), *incarnation)),
                Some(Slot::Loading { .. }) => return Err(RegistryError::RoomLoading { room_id }),
                None => None,
            };

            match existing_room {
                Some((room, incarnation)) => {
                    return self.claim_active_room_locked(
                        &mut inner,
                        user_id,
                        room_id,
                        room,
                        incarnation,
                    );
                }
                None => self.prepare_loading_claim_locked(&mut inner, user_id, room_id)?,
            }
        };

        let ctx = LoaderContext {
            room_id,
            incarnation: guard.incarnation(),
            registry: Arc::downgrade(self),
        };
        let room = match loader(ctx).await {
            Ok(room) => room,
            Err(source) => {
                return Err(RegistryError::LoadFailed {
                    room_id,
                    user_id: Some(user_id),
                    source,
                });
            }
        };

        {
            let mut inner = self.inner.lock();
            let same_loading_slot = matches!(
                inner.slots.get(&room_id),
                Some(Slot::Loading { incarnation }) if *incarnation == guard.incarnation()
            );
            if !same_loading_slot {
                return Err(RegistryError::LoadingAborted {
                    room_id,
                    user_id: Some(user_id),
                });
            }

            if !Self::finalize_loading_claim_locked(&mut inner, user_id, room_id, &guard.kind) {
                return Err(RegistryError::LoadingAborted {
                    room_id,
                    user_id: Some(user_id),
                });
            }

            inner.slots.insert(
                room_id,
                Slot::Active {
                    room: Arc::clone(&room),
                    incarnation: guard.incarnation(),
                },
            );
            guard.mark_published();
        }

        Ok((room, guard))
    }
}

impl UserSlot for SingleSlot {
    const CAPACITY: Option<usize> = Some(1);

    fn new_with(entry: UserIndexEntry) -> Self {
        Self(entry)
    }

    fn len(&self) -> usize {
        1
    }

    fn is_empty(&self) -> bool {
        false
    }

    fn find(&self, room_id: Ulid) -> Option<&UserIndexEntry> {
        (self.0.room_id == room_id).then_some(&self.0)
    }

    fn find_mut(&mut self, room_id: Ulid) -> Option<&mut UserIndexEntry> {
        (self.0.room_id == room_id).then_some(&mut self.0)
    }

    fn insert(&mut self, _entry: UserIndexEntry) -> bool {
        false
    }

    fn remove(&mut self, room_id: Ulid) -> RemoveResult {
        if self.0.room_id == room_id {
            RemoveResult::RemovedAndEmpty
        } else {
            RemoveResult::NotFound
        }
    }

    fn for_each(&self, mut f: impl FnMut(&UserIndexEntry)) {
        f(&self.0);
    }
}

impl<const N: usize> UserSlot for UnlimitedSlot<N> {
    const CAPACITY: Option<usize> = None;

    fn new_with(entry: UserIndexEntry) -> Self {
        let mut entries = SmallVec::new();
        entries.push(entry);
        Self(entries)
    }

    fn len(&self) -> usize {
        self.0.len()
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    fn find(&self, room_id: Ulid) -> Option<&UserIndexEntry> {
        self.0.iter().find(|entry| entry.room_id == room_id)
    }

    fn find_mut(&mut self, room_id: Ulid) -> Option<&mut UserIndexEntry> {
        self.0.iter_mut().find(|entry| entry.room_id == room_id)
    }

    fn insert(&mut self, entry: UserIndexEntry) -> bool {
        debug_assert!(
            self.0
                .iter()
                .all(|existing| existing.room_id != entry.room_id),
            "duplicate room ids within one user slot violate the registry invariant"
        );
        self.0.push(entry);
        true
    }

    fn remove(&mut self, room_id: Ulid) -> RemoveResult {
        let Some(position) = self.0.iter().position(|entry| entry.room_id == room_id) else {
            return RemoveResult::NotFound;
        };

        self.0.remove(position);
        if self.0.is_empty() {
            RemoveResult::RemovedAndEmpty
        } else {
            RemoveResult::Removed
        }
    }

    fn for_each(&self, f: impl FnMut(&UserIndexEntry)) {
        self.0.iter().for_each(f);
    }
}

#[cfg(test)]
impl<R: Send + Sync + 'static, S: UserSlot> RoomRegistry<R, S> {
    pub(crate) fn insert_loading_for_test(&self, room_id: Ulid) {
        self.inner.lock().slots.insert(
            room_id,
            Slot::Loading {
                incarnation: self.next_incarnation(),
            },
        );
    }

    pub(crate) fn insert_active_for_test(&self, room_id: Ulid, room: Arc<R>) {
        self.inner.lock().slots.insert(
            room_id,
            Slot::Active {
                room,
                incarnation: self.next_incarnation(),
            },
        );
    }

    pub(crate) fn destroy_room_for_test(&self, room_id: Ulid) {
        let mut inner = self.inner.lock();
        let _ = Self::destroy_locked(&mut inner, room_id);
    }

    pub(crate) fn insert_user_entry_for_test(&self, user_id: i32, entry: UserIndexEntry) {
        use std::collections::hash_map::Entry;

        match self.inner.lock().index.entry(user_id) {
            Entry::Occupied(mut occupied) => {
                assert!(
                    occupied.get_mut().insert(entry),
                    "test helper requires structural capacity for inserted entry"
                );
            }
            Entry::Vacant(vacant) => {
                vacant.insert(S::new_with(entry));
            }
        }
    }

    pub(crate) fn counters_for_test(&self) -> (u64, u64) {
        use std::sync::atomic::Ordering;

        (
            self.next_generation.load(Ordering::Relaxed),
            self.next_incarnation.load(Ordering::Relaxed),
        )
    }
}
