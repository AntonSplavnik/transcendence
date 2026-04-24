use std::mem::size_of;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::{
    ClaimCommitError, DestroyResult, EntryState, RegistryError, RemoveResult, RoomRegistry,
    SingleSlot, UnlimitedSlot, UserIndexEntry, UserSlot,
};
use anyhow::anyhow;
use tokio::sync::{Notify, oneshot};
use ulid::Ulid;

#[derive(Debug)]
struct TestRoom;

fn entry(room_id: Ulid, state: EntryState) -> UserIndexEntry {
    UserIndexEntry { room_id, state }
}

fn sorted_users<R>(mut destroyed: DestroyResult<R>) -> DestroyResult<R>
where
    R: Send + Sync + 'static,
{
    destroyed.users.sort_unstable();
    destroyed
}

#[test]
fn single_slot_has_fixed_capacity_and_zero_overhead() {
    let room_id = Ulid::new();
    let entry = entry(room_id, EntryState::Live);

    let slot = SingleSlot::new_with(entry);

    assert_eq!(SingleSlot::CAPACITY, Some(1));
    assert_eq!(
        slot.len(),
        1,
        "single-slot registries always store one entry"
    );
    assert!(
        !slot.is_empty(),
        "occupied slots are never structurally empty"
    );
    assert_eq!(
        slot.find(room_id).map(|entry| (entry.room_id, entry.state)),
        Some((room_id, EntryState::Live)),
        "the stored entry must be returned by room id"
    );
    assert_eq!(
        size_of::<SingleSlot>(),
        size_of::<UserIndexEntry>(),
        "SingleSlot must stay zero-overhead over UserIndexEntry"
    );
}

#[test]
fn single_slot_rejects_second_entry_and_allows_mutating_the_stored_entry() {
    let room_id = Ulid::new();
    let other_room_id = Ulid::new();
    let mut slot = SingleSlot::new_with(entry(room_id, EntryState::Reserved { generation: 7 }));

    assert!(
        !slot.insert(entry(other_room_id, EntryState::Live)),
        "single-slot registries must reject a second structural entry"
    );

    slot.find_mut(room_id)
        .expect("the original entry must remain addressable")
        .state = EntryState::Live;

    assert_eq!(
        slot.find(room_id).map(|entry| entry.state),
        Some(EntryState::Live),
        "find_mut must update the only stored entry"
    );
    assert!(
        slot.find(other_room_id).is_none(),
        "a rejected insert must not appear in later lookups"
    );
}

#[test]
fn single_slot_remove_returns_removed_and_empty_only_for_matching_room() {
    let room_id = Ulid::new();
    let mut slot = SingleSlot::new_with(entry(room_id, EntryState::Reserved { generation: 7 }));

    assert_eq!(slot.clone().remove(Ulid::new()), RemoveResult::NotFound);
    assert_eq!(slot.remove(room_id), RemoveResult::RemovedAndEmpty);
}

#[test]
fn unlimited_slot_accepts_multiple_entries_without_structural_cap() {
    let first = entry(Ulid::new(), EntryState::Live);
    let second = entry(Ulid::new(), EntryState::Reserved { generation: 11 });
    let third = entry(Ulid::new(), EntryState::Live);

    let mut slot = UnlimitedSlot::<1>::new_with(first);

    assert_eq!(UnlimitedSlot::<1>::CAPACITY, None);
    assert!(
        slot.insert(second),
        "UnlimitedSlot must accept additional entries"
    );
    assert!(
        slot.insert(third),
        "UnlimitedSlot must spill beyond inline capacity"
    );
    assert_eq!(slot.len(), 3);
    assert_eq!(
        slot.find(second.room_id).map(|entry| entry.state),
        Some(EntryState::Reserved { generation: 11 }),
        "slot lookups must preserve reserved state"
    );
}

#[test]
fn unlimited_slot_remove_reports_when_entries_remain_or_slot_empties() {
    let first = entry(Ulid::new(), EntryState::Live);
    let second = entry(Ulid::new(), EntryState::Reserved { generation: 11 });
    let third = entry(Ulid::new(), EntryState::Live);
    let mut slot = UnlimitedSlot::<1>::new_with(first);

    assert!(slot.insert(second));
    assert!(slot.insert(third));
    assert_eq!(
        slot.remove(Ulid::new()),
        RemoveResult::NotFound,
        "removing an unknown room must leave the slot unchanged"
    );

    assert_eq!(
        slot.remove(second.room_id),
        RemoveResult::Removed,
        "removing one of several entries must keep the slot occupied"
    );
    assert_eq!(slot.len(), 2, "one entry must be removed from the slot");
    assert!(
        slot.find(second.room_id).is_none(),
        "removed entries must no longer be discoverable"
    );

    assert_eq!(
        slot.remove(first.room_id),
        RemoveResult::Removed,
        "removing the penultimate entry must still report a non-empty slot"
    );
    assert_eq!(
        slot.remove(third.room_id),
        RemoveResult::RemovedAndEmpty,
        "removing the final entry must report that the slot became empty"
    );
    assert!(
        slot.is_empty(),
        "all entries should be gone after the final remove"
    );
}

#[test]
fn unlimited_slot_find_mut_and_for_each_reflect_updated_entries() {
    let first = entry(Ulid::new(), EntryState::Live);
    let second = entry(Ulid::new(), EntryState::Reserved { generation: 3 });
    let mut slot = UnlimitedSlot::<2>::new_with(first);

    assert!(slot.insert(second));

    slot.find_mut(second.room_id)
        .expect("the inserted entry must be mutable by room id")
        .state = EntryState::Live;

    let mut seen = Vec::new();
    slot.for_each(|entry| seen.push((entry.room_id, entry.state)));

    let mut expected = vec![
        (first.room_id, EntryState::Live),
        (second.room_id, EntryState::Live),
    ];

    seen.sort_unstable_by_key(|(room_id, _)| *room_id);
    expected.sort_unstable_by_key(|(room_id, _)| *room_id);

    assert_eq!(
        seen, expected,
        "for_each must visit every entry with its latest state"
    );
}

#[cfg(debug_assertions)]
#[test]
fn unlimited_slot_duplicate_room_id_insert_panics_in_debug_builds() {
    let room_id = Ulid::new();
    let mut slot = UnlimitedSlot::<2>::new_with(entry(room_id, EntryState::Live));

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = slot.insert(entry(room_id, EntryState::Reserved { generation: 9 }));
    }));

    assert!(
        result.is_err(),
        "duplicate room ids within one user slot must trip the debug invariant"
    );
}

#[test]
fn room_registry_lookup_room_returns_none_for_loading_and_missing_rooms() {
    let registry = RoomRegistry::<TestRoom>::new();
    let loading_room_id = Ulid::new();

    registry.insert_loading_for_test(loading_room_id);

    assert!(
        registry.lookup_room(loading_room_id).is_none(),
        "lookup_room must hide loading slots"
    );
    assert!(
        registry.lookup_room(Ulid::new()).is_none(),
        "lookup_room must return None for absent room ids"
    );
}

#[test]
fn room_registry_lookup_room_clones_active_room_handle() {
    let registry = RoomRegistry::<TestRoom>::new();
    let active_room_id = Ulid::new();
    let active_room = Arc::new(TestRoom);

    registry.insert_active_for_test(active_room_id, Arc::clone(&active_room));

    let looked_up = registry
        .lookup_room(active_room_id)
        .expect("an active room must be returned");

    assert!(
        Arc::ptr_eq(&looked_up, &active_room),
        "lookup_room must clone the stored Arc without inspecting the room value"
    );
}

#[test]
fn room_registry_rooms_and_room_count_exclude_loading_entries() {
    let registry = RoomRegistry::<TestRoom>::new();
    let loading_room_id = Ulid::new();
    let active_room_id = Ulid::new();
    let active_room = Arc::new(TestRoom);

    registry.insert_loading_for_test(loading_room_id);
    registry.insert_active_for_test(active_room_id, Arc::clone(&active_room));

    let rooms = registry.rooms();

    assert_eq!(
        registry.room_count(),
        1,
        "room_count must exclude loading slots"
    );
    assert_eq!(rooms.len(), 1, "rooms() must return only active rooms");
    assert_eq!(
        rooms[0].0, active_room_id,
        "rooms() must omit loading room ids"
    );
    assert!(
        Arc::ptr_eq(&rooms[0].1, &active_room),
        "rooms() must clone the stored Arc for active rooms"
    );
}

#[test]
fn room_registry_user_room_count_counts_live_and_reserved_entries() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let live_room_id = Ulid::new();
    let reserved_room_id = Ulid::new();

    registry.insert_user_entry_for_test(42, entry(live_room_id, EntryState::Live));
    registry.insert_user_entry_for_test(
        42,
        entry(reserved_room_id, EntryState::Reserved { generation: 1 }),
    );

    assert_eq!(
        registry.user_room_count(42),
        2,
        "user_room_count must include both live and reserved structural entries"
    );
    assert_eq!(
        registry.user_room_count(7),
        0,
        "users without an index entry must report zero rooms"
    );
}

#[test]
fn room_registry_lookup_user_returns_an_independent_slot_clone() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let room_id = Ulid::new();

    registry.insert_user_entry_for_test(42, entry(room_id, EntryState::Reserved { generation: 1 }));

    let mut user_slot = registry
        .lookup_user(42)
        .expect("test setup inserted entries for this user");

    user_slot
        .find_mut(room_id)
        .expect("the cloned slot must still expose the entry")
        .state = EntryState::Live;

    let stored_slot = registry
        .lookup_user(42)
        .expect("test setup inserted entries for this user");

    assert_eq!(
        stored_slot.find(room_id).map(|entry| entry.state),
        Some(EntryState::Reserved { generation: 1 }),
        "lookup_user must return a cloned slot, not a mutable view into registry state"
    );
}

#[test]
fn room_registry_lookup_user_returns_all_structural_entries() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let reserved_room_id = Ulid::new();
    let live_room_id = Ulid::new();

    registry.insert_user_entry_for_test(
        42,
        entry(reserved_room_id, EntryState::Reserved { generation: 1 }),
    );
    registry.insert_user_entry_for_test(42, entry(live_room_id, EntryState::Live));

    let user_slot = registry
        .lookup_user(42)
        .expect("test setup inserted entries for this user");

    assert_eq!(
        user_slot.len(),
        2,
        "lookup_user must clone the full user slot"
    );
    assert_eq!(
        user_slot.find(reserved_room_id).map(|entry| entry.state),
        Some(EntryState::Reserved { generation: 1 }),
        "lookup_user must expose reserved entries without resolving room state"
    );
    assert_eq!(
        user_slot.find(live_room_id).map(|entry| entry.state),
        Some(EntryState::Live),
        "lookup_user must include live entries alongside reserved ones"
    );
}

#[test]
fn room_registry_new_starts_generations_at_one() {
    let registry = RoomRegistry::<TestRoom>::new();

    assert_eq!(
        registry.counters_for_test(),
        (1, 1),
        "registry counters must start at one so zero stays available as a sentinel"
    );
}

#[tokio::test]
async fn room_registry_ensure_room_does_not_run_loader_twice_while_loading() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let loader_calls = Arc::new(AtomicUsize::new(0));
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let first_registry = Arc::clone(&registry);
    let loader_registry = Arc::clone(&registry);
    let first_calls = Arc::clone(&loader_calls);
    let first_allow_finish = Arc::clone(&allow_finish);
    let first = tokio::spawn(async move {
        first_registry
            .ensure_room(room_id, move |ctx| async move {
                first_calls.fetch_add(1, Ordering::SeqCst);
                assert_eq!(
                    ctx.room_id, room_id,
                    "loader context must preserve room identity"
                );
                assert!(
                    ctx.incarnation > 0,
                    "loader context must carry a non-zero incarnation"
                );
                let link = ctx.make_link();
                assert_eq!(
                    link.room_id(),
                    room_id,
                    "loader links must preserve the unpublished room id"
                );
                assert_eq!(
                    link.incarnation(),
                    ctx.incarnation,
                    "loader links must preserve the captured slot incarnation"
                );
                assert!(
                    Arc::ptr_eq(
                        &link
                            .registry()
                            .upgrade()
                            .expect("loader links must point at a live registry"),
                        &loader_registry,
                    ),
                    "loader links must point back to the same registry instance"
                );
                assert!(
                    ctx.registry
                        .upgrade()
                        .expect("loader context must point at a live registry")
                        .lookup_room(room_id)
                        .is_none(),
                    "room must stay unpublished until the loader returns"
                );
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                first_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("first loader must reach the suspended loading phase");

    let second_calls = Arc::clone(&loader_calls);
    let second = registry
        .ensure_room(room_id, move |_| async move {
            second_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(TestRoom))
        })
        .await;

    assert!(
        matches!(second, Err(RegistryError::RoomLoading { room_id: id }) if id == room_id),
        "second ensure_room must fail with RoomLoading while publication is still pending"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        1,
        "the competing loader must not run while the room is already loading"
    );

    allow_finish.notify_one();
    let first_room = first
        .await
        .expect("first ensure_room task must not panic")
        .expect("first loader should publish the room successfully");

    assert!(
        Arc::ptr_eq(
            &first_room,
            &registry
                .lookup_room(room_id)
                .expect("published room must be visible after ensure_room succeeds")
        ),
        "successful publication must store the same Arc returned by the loader"
    );
}

#[tokio::test]
async fn room_registry_ensure_room_returns_loading_aborted_when_slot_disappears_before_publish() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let task_registry = Arc::clone(&registry);
    let task_allow_finish = Arc::clone(&allow_finish);
    let task = tokio::spawn(async move {
        task_registry
            .ensure_room(room_id, move |_| async move {
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                task_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("loader must reach the suspended loading phase before test removal");

    registry.destroy_room_for_test(room_id);
    allow_finish.notify_one();

    let result = task.await.expect("ensure_room task must not panic");

    assert!(
        matches!(result, Err(RegistryError::LoadingAborted { room_id: id, user_id: None }) if id == room_id),
        "publication must fail cleanly when the loading slot disappears before finalization"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "aborted publication must leave no published room behind"
    );
    assert_eq!(
        registry.room_count(),
        0,
        "aborted publication must leave the registry structurally empty"
    );

    let retried_room = registry
        .ensure_room(room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("a later ensure_room must be able to recreate the room after an abort");

    assert!(
        Arc::ptr_eq(
            &retried_room,
            &registry
                .lookup_room(room_id)
                .expect("the retried load must publish the replacement room"),
        ),
        "retrying after an aborted publication must publish the new room"
    );
}

#[tokio::test]
async fn room_registry_ensure_and_claim_cancellation_rolls_back_loading_slot_and_user_claim() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let task_registry = Arc::clone(&registry);
    let task_allow_finish = Arc::clone(&allow_finish);
    let task = tokio::spawn(async move {
        task_registry
            .ensure_and_claim(user_id, room_id, move |_| async move {
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                task_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("loader must reach the suspended loading phase before cancellation");

    task.abort();
    let join_error = task
        .await
        .expect_err("aborted task must not report a successful result");
    assert!(
        join_error.is_cancelled(),
        "task abort must surface as cancellation"
    );

    assert!(
        registry.lookup_room(room_id).is_none(),
        "cancelling the loader must roll back the unpublished loading slot"
    );
    assert!(
        registry.lookup_user(user_id).is_none(),
        "cancelling the loader must roll back the provisional user claim"
    );
    assert_eq!(
        registry.user_room_count(user_id),
        0,
        "cancelling the loader must leave no structural user entries behind"
    );

    allow_finish.notify_one();
}

#[tokio::test]
async fn room_registry_ensure_room_load_failed_rolls_back_loading_slot_for_retry() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();

    let result = registry
        .ensure_room(room_id, |_| async move { Err(anyhow!("loader failed")) })
        .await;

    assert!(
        matches!(result, Err(RegistryError::LoadFailed { room_id: id, user_id: None, .. }) if id == room_id),
        "loader errors must surface as LoadFailed without a user id for ensure_room"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "a failed ensure_room loader must not publish the room"
    );
    assert_eq!(
        registry.room_count(),
        0,
        "a failed ensure_room loader must not leave a loading slot behind"
    );

    let retried_room = registry
        .ensure_room(room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("ensure_room must allow retry after a failed loader");

    assert!(
        Arc::ptr_eq(
            &retried_room,
            &registry
                .lookup_room(room_id)
                .expect("retry after ensure_room failure must publish the room"),
        ),
        "retrying after an ensure_room loader failure must publish the new room"
    );
}

#[tokio::test]
async fn room_registry_ensure_and_claim_returns_room_loading_while_same_room_loader_is_in_progress()
{
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let first_user_id = 42;
    let second_user_id = 43;
    let loader_calls = Arc::new(AtomicUsize::new(0));
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let first_registry = Arc::clone(&registry);
    let first_calls = Arc::clone(&loader_calls);
    let first_allow_finish = Arc::clone(&allow_finish);
    let first = tokio::spawn(async move {
        first_registry
            .ensure_and_claim(first_user_id, room_id, move |_| async move {
                first_calls.fetch_add(1, Ordering::SeqCst);
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                first_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("first loader must reach the suspended loading phase");

    let second_calls = Arc::clone(&loader_calls);
    let second = registry
        .ensure_and_claim(second_user_id, room_id, move |_| async move {
            second_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(TestRoom))
        })
        .await;

    assert!(
        matches!(second, Err(RegistryError::RoomLoading { room_id: id }) if id == room_id),
        "ensure_and_claim must report RoomLoading while another load owns the slot"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        1,
        "the competing ensure_and_claim call must not run its loader"
    );
    assert!(
        registry.lookup_user(second_user_id).is_none(),
        "a rejected concurrent claim must not leave a provisional user entry behind"
    );

    allow_finish.notify_one();
    let (first_room, mut first_guard) = first
        .await
        .expect("first ensure_and_claim task must not panic")
        .expect("first loader should publish the room successfully");

    assert!(
        Arc::ptr_eq(
            &first_room,
            &registry
                .lookup_room(room_id)
                .expect("published room must be visible after ensure_and_claim succeeds"),
        ),
        "successful ensure_and_claim publication must store the same Arc returned by the loader"
    );
    first_guard
        .commit()
        .expect("the published claim must still be committable on the happy path");
    drop(first_guard);
    assert_eq!(
        registry
            .lookup_user(first_user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "committing the first claim must leave that user live in the published room"
    );
}

#[tokio::test]
async fn room_registry_ensure_and_claim_same_user_same_room_while_loading_returns_already_claimed()
{
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;
    let loader_calls = Arc::new(AtomicUsize::new(0));
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let first_registry = Arc::clone(&registry);
    let first_calls = Arc::clone(&loader_calls);
    let first_allow_finish = Arc::clone(&allow_finish);
    let first = tokio::spawn(async move {
        first_registry
            .ensure_and_claim(user_id, room_id, move |_| async move {
                first_calls.fetch_add(1, Ordering::SeqCst);
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                first_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("first loader must reach the suspended loading phase");

    let second_calls = Arc::clone(&loader_calls);
    let second = registry
        .ensure_and_claim(user_id, room_id, move |_| async move {
            second_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(TestRoom))
        })
        .await;

    assert!(
        matches!(
            second,
            Err(RegistryError::AlreadyClaimed {
                room_id: claimed_room_id,
                user_id: claimed_user_id,
            }) if claimed_room_id == room_id && claimed_user_id == user_id
        ),
        "same-user same-room retries must report AlreadyClaimed before classifying the shared room slot as loading"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        1,
        "the duplicate same-user request must not start a second loader"
    );

    allow_finish.notify_one();
    let (_room, mut first_guard) = first
        .await
        .expect("first ensure_and_claim task must not panic")
        .expect("first loader should publish the room successfully");
    first_guard
        .commit()
        .expect("the original claim must remain committable after rejecting the duplicate");
}

#[tokio::test]
async fn room_registry_ensure_and_claim_reserved_entry_returns_user_reserved_without_starting_loader()
 {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;
    let generation = 7;
    let loader_calls = Arc::new(AtomicUsize::new(0));

    registry
        .insert_user_entry_for_test(user_id, entry(room_id, EntryState::Reserved { generation }));

    let claim_calls = Arc::clone(&loader_calls);
    let result = registry
        .ensure_and_claim(user_id, room_id, move |_| async move {
            claim_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(TestRoom))
        })
        .await;

    assert!(
        matches!(
            result,
            Err(RegistryError::UserReserved {
                user_id: claim_user_id,
                room_id: claim_room_id,
                generation: claim_generation,
            }) if claim_user_id == user_id && claim_room_id == room_id && claim_generation == generation
        ),
        "ensure_and_claim must reject pre-existing reservations and direct callers to claim_reserved"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        0,
        "ensure_and_claim must return UserReserved before starting the loader"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation }),
        "returning UserReserved must leave the reservation untouched"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "returning UserReserved must not publish or install a loading slot for the room"
    );

    let loaded_room = registry
        .ensure_room(room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect(
            "returning UserReserved must leave the room available for a later ensure_room load",
        );

    assert!(
        Arc::ptr_eq(
            &loaded_room,
            &registry
                .lookup_room(room_id)
                .expect("ensure_room must still be able to publish the room afterward"),
        ),
        "a reserved-entry rejection must not strand the room id in RoomLoading"
    );
}

#[tokio::test]
async fn room_registry_ensure_and_claim_reserved_entry_while_room_loading_returns_user_reserved() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let reserved_user_id = 42;
    let loading_user_id = 43;
    let generation = 7;
    let loader_calls = Arc::new(AtomicUsize::new(0));
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    registry.insert_user_entry_for_test(
        reserved_user_id,
        entry(room_id, EntryState::Reserved { generation }),
    );

    let first_registry = Arc::clone(&registry);
    let first_calls = Arc::clone(&loader_calls);
    let first_allow_finish = Arc::clone(&allow_finish);
    let first = tokio::spawn(async move {
        first_registry
            .ensure_and_claim(loading_user_id, room_id, move |_| async move {
                first_calls.fetch_add(1, Ordering::SeqCst);
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                first_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("the first loader must reach the loading phase before the reserved retry");

    let result = registry
        .ensure_and_claim(reserved_user_id, room_id, |_| async {
            Ok(Arc::new(TestRoom))
        })
        .await;

    assert!(
        matches!(
            result,
            Err(RegistryError::UserReserved {
                user_id: claim_user_id,
                room_id: claim_room_id,
                generation: claim_generation,
            }) if claim_user_id == reserved_user_id && claim_room_id == room_id && claim_generation == generation
        ),
        "reserved callers must receive UserReserved before the shared room slot is classified as RoomLoading"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        1,
        "returning UserReserved during another user's load must not start a second loader"
    );
    assert_eq!(
        registry
            .lookup_user(reserved_user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation }),
        "returning UserReserved during loading must leave the reservation untouched"
    );

    allow_finish.notify_one();
    let (_room, mut first_guard) = first
        .await
        .expect("the initial loading task must not panic")
        .expect("the initial loader must still publish the room successfully");
    first_guard
        .commit()
        .expect("rejecting the reserved retry must not break the original loader's claim");
}

#[tokio::test]
async fn room_registry_ensure_and_claim_rejects_second_different_room_when_single_slot_is_full() {
    let registry = RoomRegistry::<TestRoom>::new();
    let first_room_id = Ulid::new();
    let second_room_id = Ulid::new();
    let user_id = 42;
    let loader_calls = Arc::new(AtomicUsize::new(0));

    let (first_room, mut first_guard) = registry
        .ensure_and_claim(user_id, first_room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("the first room claim must succeed for an empty SingleSlot registry");
    first_guard
        .commit()
        .expect("the first published claim must remain committable");
    drop(first_guard);
    assert!(
        Arc::ptr_eq(
            &first_room,
            &registry
                .lookup_room(first_room_id)
                .expect("the first room must be published before testing structural rejection"),
        ),
        "the initial claim must leave the first room published"
    );
    let counters_before_second_claim = registry.counters_for_test();

    let second_calls = Arc::clone(&loader_calls);
    let result = registry
        .ensure_and_claim(user_id, second_room_id, move |_| async move {
            second_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(TestRoom))
        })
        .await;

    assert!(
        matches!(
            result,
            Err(RegistryError::MaxRoomsReached {
                user_id: claim_user_id,
                max,
            }) if claim_user_id == user_id && max == SingleSlot::CAPACITY
        ),
        "SingleSlot must report MaxRoomsReached for a second different room instead of conflating it with same-room AlreadyClaimed"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        0,
        "structural rejection must happen before a second-room loader starts"
    );
    assert!(
        registry.lookup_room(second_room_id).is_none(),
        "rejecting a second room must not install or publish any structural slot for it"
    );
    assert_eq!(
        registry.counters_for_test(),
        counters_before_second_claim,
        "failed structural claims must not consume a new room-slot incarnation before any loading slot is inserted"
    );
}

#[tokio::test]
async fn room_registry_ensure_and_claim_rejects_same_user_same_room_after_commit() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;
    let loader_calls = Arc::new(AtomicUsize::new(0));

    let (_room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("the initial claim must succeed");
    guard
        .commit()
        .expect("the initial published claim must stay committable");
    drop(guard);

    let second_calls = Arc::clone(&loader_calls);
    let result = registry
        .ensure_and_claim(user_id, room_id, move |_| async move {
            second_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Arc::new(TestRoom))
        })
        .await;

    assert!(
        matches!(
            result,
            Err(RegistryError::AlreadyClaimed {
                room_id: claimed_room_id,
                user_id: claimed_user_id,
            }) if claimed_room_id == room_id && claimed_user_id == user_id
        ),
        "a same-user duplicate join for the same published room must report AlreadyClaimed"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        0,
        "same-room duplicate claims must not re-run the room loader"
    );
}

#[tokio::test]
async fn room_registry_mark_reserved_transitions_live_claim_to_reserved_generation() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed before it can be reserved");
    guard
        .commit()
        .expect("initial claim must stay committable before reservation");
    drop(guard);

    let generation = registry
        .mark_reserved(user_id, room_id)
        .expect("mark_reserved must reserve an existing live claim");

    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation }),
        "mark_reserved must transition the user's structural entry from Live to Reserved"
    );
    assert_eq!(
        registry.mark_reserved(user_id, room_id),
        Some(generation),
        "mark_reserved must be idempotent for an already-reserved entry"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("reserving a user must not remove the active room slot"),
            &room,
        ),
        "mark_reserved must keep the existing active room published"
    );
}

#[test]
fn room_registry_mark_reserved_returns_none_for_missing_entry() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let other_room_id = Ulid::new();
    let user_id = 42;
    let other_user_id = 43;
    let room = Arc::new(TestRoom);

    registry.insert_active_for_test(room_id, Arc::clone(&room));
    registry.insert_active_for_test(other_room_id, Arc::new(TestRoom));
    registry.insert_user_entry_for_test(other_user_id, entry(other_room_id, EntryState::Live));

    assert_eq!(
        registry.mark_reserved(user_id, room_id),
        None,
        "mark_reserved must return None when the user has no entry for that room"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("mark_reserved missing-entry must not remove the active room slot"),
            &room,
        ),
        "mark_reserved missing-entry must not disturb the active room slot"
    );
    assert!(
        registry.lookup_user(user_id).is_none(),
        "mark_reserved missing-entry must not create a new user slot"
    );
    assert_eq!(
        registry
            .lookup_user(other_user_id)
            .and_then(|slot| slot.find(other_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "mark_reserved missing-entry must leave unrelated user entries untouched"
    );
}

#[test]
fn room_registry_mark_reserved_returns_none_for_non_active_room() {
    let absent_registry = RoomRegistry::<TestRoom>::new();
    let absent_room_id = Ulid::new();
    let loading_registry = RoomRegistry::<TestRoom>::new();
    let loading_room_id = Ulid::new();
    let user_id = 42;

    absent_registry.insert_user_entry_for_test(user_id, entry(absent_room_id, EntryState::Live));
    loading_registry.insert_loading_for_test(loading_room_id);
    loading_registry.insert_user_entry_for_test(user_id, entry(loading_room_id, EntryState::Live));

    #[cfg(debug_assertions)]
    {
        let absent = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            absent_registry.mark_reserved(user_id, absent_room_id)
        }));
        let loading = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            loading_registry.mark_reserved(user_id, loading_room_id)
        }));

        assert!(
            absent.is_err(),
            "debug builds must trip the invariant assertion when mark_reserved sees an absent room slot"
        );
        assert!(
            loading.is_err(),
            "debug builds must trip the invariant assertion when mark_reserved sees a loading room slot"
        );
    }

    #[cfg(not(debug_assertions))]
    {
        assert_eq!(
            absent_registry.mark_reserved(user_id, absent_room_id),
            None,
            "mark_reserved must return None when the unchecked caller's room no longer has an active slot"
        );
        assert_eq!(
            loading_registry.mark_reserved(user_id, loading_room_id),
            None,
            "mark_reserved must return None when the unchecked caller races with a loading slot"
        );
    }

    assert_eq!(
        absent_registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(absent_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "non-active mark_reserved must leave the absent-room entry unchanged"
    );
    assert_eq!(
        loading_registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(loading_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "non-active mark_reserved must leave the loading-room entry unchanged"
    );
    assert!(
        absent_registry.lookup_room(absent_room_id).is_none(),
        "non-active mark_reserved must not publish an absent room"
    );
    assert!(
        loading_registry.lookup_room(loading_room_id).is_none(),
        "non-active mark_reserved must not convert a loading slot into an active room"
    );
}

#[tokio::test]
async fn room_registry_mark_reserved_if_matches_requires_matching_incarnation() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    let incarnation = guard.incarnation();
    guard.commit().expect("initial claim must stay committable");
    drop(guard);

    assert_eq!(
        registry.mark_reserved_if_matches(user_id, room_id, incarnation + 1),
        None,
        "mark_reserved_if_matches must no-op when the captured incarnation is stale"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "stale mark_reserved_if_matches must leave the live claim unchanged"
    );

    let generation = registry
        .mark_reserved_if_matches(user_id, room_id, incarnation)
        .expect(
            "mark_reserved_if_matches must reserve when the captured incarnation still matches",
        );
    assert_eq!(
        registry.mark_reserved_if_matches(user_id, room_id, incarnation),
        Some(generation),
        "mark_reserved_if_matches must be idempotent for the same reserved generation"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation }),
        "idempotent mark_reserved_if_matches must leave the entry at the same reserved generation"
    );
}

#[tokio::test]
async fn room_registry_claim_reserved_returns_same_active_arc_and_live_claim() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    guard
        .commit()
        .expect("initial claim must stay committable before reservation");
    drop(guard);
    let generation = registry
        .mark_reserved(user_id, room_id)
        .expect("reservation setup must succeed");

    let (rejoined_room, mut rejoin_guard) = registry
        .claim_reserved(user_id, room_id, generation)
        .expect("claim_reserved must promote a matching reservation back to Live");

    assert!(
        Arc::ptr_eq(&rejoined_room, &room),
        "claim_reserved must reuse the already-published Arc instead of invoking a loader"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "claim_reserved must promote the reserved entry back to Live under the registry lock"
    );

    rejoin_guard
        .commit()
        .expect("the happy-path rejoin guard must remain committable");
}

#[tokio::test]
async fn room_registry_claim_reserved_reports_generation_mismatch() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    guard.commit().expect("initial claim must stay committable");
    drop(guard);
    let generation = registry
        .mark_reserved(user_id, room_id)
        .expect("reservation setup must succeed");

    assert!(
        matches!(
            registry.claim_reserved(user_id, room_id, generation + 1),
            Err(RegistryError::GenerationMismatch {
                room_id: mismatched_room_id,
                user_id: mismatched_user_id,
                expected,
                actual,
            }) if mismatched_room_id == room_id
                && mismatched_user_id == user_id
                && expected == generation
                && actual == generation + 1
        ),
        "claim_reserved must reject stale reservation generations with a structured mismatch error"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation }),
        "generation mismatch must leave the reservation unchanged for a retry with the correct generation"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("generation mismatch must not disturb the published room"),
            &room,
        ),
        "generation mismatch must not replace or remove the active room handle"
    );
}

#[tokio::test]
async fn room_registry_claim_reserved_reports_reservation_not_found_and_already_live() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let missing_user_id = 42;
    let live_user_id = 43;

    let room = registry
        .ensure_room(room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("published room setup must succeed");

    assert!(
        matches!(
            registry.claim_reserved(missing_user_id, room_id, 1),
            Err(RegistryError::ReservationNotFound {
                room_id: missing_room_id,
                user_id,
            }) if missing_room_id == room_id && user_id == missing_user_id
        ),
        "claim_reserved must reject users who do not currently hold a reservation"
    );
    assert!(
        registry.lookup_user(missing_user_id).is_none(),
        "ReservationNotFound must not create a user entry for the missing user"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("ReservationNotFound must not disturb the published room"),
            &room,
        ),
        "ReservationNotFound must leave the active room handle untouched"
    );

    let (_room, mut live_guard) = registry
        .ensure_and_claim(live_user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("live-claim setup must succeed");
    live_guard
        .commit()
        .expect("live-claim setup must stay committable");
    drop(live_guard);

    assert!(
        matches!(
            registry.claim_reserved(live_user_id, room_id, 1),
            Err(RegistryError::AlreadyLive {
                room_id: live_room_id,
                user_id,
            }) if live_room_id == room_id && user_id == live_user_id
        ),
        "claim_reserved must reject entries that are already Live instead of treating them as reservations"
    );
    assert_eq!(
        registry
            .lookup_user(live_user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "AlreadyLive must leave the existing live claim unchanged"
    );
}

#[test]
fn room_registry_claim_reserved_reports_room_not_found_for_missing_or_loading_room() {
    let absent_registry = RoomRegistry::<TestRoom>::new();
    let absent_room_id = Ulid::new();
    let loading_registry = RoomRegistry::<TestRoom>::new();
    let loading_room_id = Ulid::new();
    let user_id = 42;
    let generation = 7;

    absent_registry.insert_user_entry_for_test(
        user_id,
        entry(absent_room_id, EntryState::Reserved { generation }),
    );
    loading_registry.insert_loading_for_test(loading_room_id);
    loading_registry.insert_user_entry_for_test(
        user_id,
        entry(loading_room_id, EntryState::Reserved { generation }),
    );

    #[cfg(debug_assertions)]
    {
        let absent = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            absent_registry.claim_reserved(user_id, absent_room_id, generation)
        }));
        let loading = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            loading_registry.claim_reserved(user_id, loading_room_id, generation)
        }));

        assert!(
            absent.is_err(),
            "debug builds must trip the invariant assertion when a reservation points at an absent slot"
        );
        assert!(
            loading.is_err(),
            "debug builds must trip the invariant assertion when a reservation points at a loading slot"
        );

        assert_eq!(
            absent_registry
                .lookup_user(user_id)
                .and_then(|slot| slot.find(absent_room_id).map(|entry| entry.state)),
            Some(EntryState::Reserved { generation }),
            "the invariant-violation absent-room path must leave the reservation unchanged"
        );
        assert_eq!(
            loading_registry
                .lookup_user(user_id)
                .and_then(|slot| slot.find(loading_room_id).map(|entry| entry.state)),
            Some(EntryState::Reserved { generation }),
            "the invariant-violation loading-room path must leave the reservation unchanged"
        );
    }

    #[cfg(not(debug_assertions))]
    {
        assert!(
            matches!(
                absent_registry.claim_reserved(user_id, absent_room_id, generation),
                Err(RegistryError::RoomNotFound { room_id }) if room_id == absent_room_id
            ),
            "claim_reserved must defensively fail when a reservation points at an absent room slot"
        );
        assert!(
            matches!(
                loading_registry.claim_reserved(user_id, loading_room_id, generation),
                Err(RegistryError::RoomNotFound { room_id }) if room_id == loading_room_id
            ),
            "claim_reserved must defensively fail when a reservation points at a loading slot"
        );

        assert_eq!(
            absent_registry
                .lookup_user(user_id)
                .and_then(|slot| slot.find(absent_room_id).map(|entry| entry.state)),
            Some(EntryState::Reserved { generation }),
            "RoomNotFound must leave the absent-room reservation unchanged"
        );
        assert_eq!(
            loading_registry
                .lookup_user(user_id)
                .and_then(|slot| slot.find(loading_room_id).map(|entry| entry.state)),
            Some(EntryState::Reserved { generation }),
            "RoomNotFound must leave the loading-room reservation unchanged"
        );
    }

    assert!(
        absent_registry.lookup_room(absent_room_id).is_none(),
        "claim_reserved invariant failures must not publish a missing room"
    );
    assert!(
        loading_registry.lookup_room(loading_room_id).is_none(),
        "claim_reserved invariant failures must not convert a loading slot into an active room"
    );
}

#[tokio::test]
async fn room_registry_claim_reserved_guard_drop_restores_same_reserved_generation() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    guard.commit().expect("initial claim must stay committable");
    drop(guard);
    let generation = registry
        .mark_reserved(user_id, room_id)
        .expect("reservation setup must succeed");

    let (_room, rejoin_guard) = registry
        .claim_reserved(user_id, room_id, generation)
        .expect("rejoin setup must succeed");

    drop(rejoin_guard);

    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation }),
        "dropping an uncommitted rejoin guard must demote the entry back to the same reserved generation"
    );
}

#[tokio::test]
async fn room_registry_reserved_entries_consume_structural_capacity() {
    let registry = RoomRegistry::<TestRoom>::new();
    let first_room_id = Ulid::new();
    let second_room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut guard) = registry
        .ensure_and_claim(user_id, first_room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    guard.commit().expect("initial claim must stay committable");
    drop(guard);
    let generation = registry
        .mark_reserved(user_id, first_room_id)
        .expect("reservation setup must succeed");

    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(first_room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation }),
        "capacity test setup must leave the first room reserved"
    );
    assert!(
        matches!(
            registry
                .ensure_and_claim(user_id, second_room_id, |_| async { Ok(Arc::new(TestRoom)) })
                .await,
            Err(RegistryError::MaxRoomsReached { user_id: rejected_user_id, max })
                if rejected_user_id == user_id && max == SingleSlot::CAPACITY
        ),
        "reserved entries must continue to consume SingleSlot structural capacity"
    );
}

#[test]
fn room_registry_leave_if_reserved_returns_false_for_missing_or_live_entry() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let missing_user_id = 42;
    let live_user_id = 43;
    let room = Arc::new(TestRoom);

    registry.insert_active_for_test(room_id, Arc::clone(&room));
    registry.insert_user_entry_for_test(live_user_id, entry(room_id, EntryState::Live));

    assert!(
        !registry.leave_if_reserved(missing_user_id, room_id, 7),
        "leave_if_reserved must return false when the user has no entry for that room"
    );
    assert!(
        !registry.leave_if_reserved(live_user_id, room_id, 7),
        "leave_if_reserved must return false when the entry is live rather than reserved"
    );
    assert!(
        registry.lookup_user(missing_user_id).is_none(),
        "leave_if_reserved missing-entry must not create a user slot"
    );
    assert_eq!(
        registry
            .lookup_user(live_user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "leave_if_reserved false on a live entry must leave that live claim unchanged"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("leave_if_reserved false cases must not remove the active room slot"),
            &room,
        ),
        "leave_if_reserved false cases must leave the published room untouched"
    );
}

#[test]
fn room_registry_leave_if_matches_requires_matching_incarnation() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;
    let room = Arc::new(TestRoom);

    registry.insert_active_for_test(room_id, Arc::clone(&room));
    registry.insert_user_entry_for_test(user_id, entry(room_id, EntryState::Live));
    let incarnation = registry.counters_for_test().1 - 1;

    assert!(
        !registry.leave_if_matches(user_id, room_id, incarnation + 1),
        "leave_if_matches must no-op when the captured incarnation is stale"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "stale leave_if_matches must leave the live claim intact"
    );
    assert!(
        registry.leave_if_matches(user_id, room_id, incarnation),
        "leave_if_matches must remove the entry when the active slot identity still matches"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("leave_if_matches must not remove the active room slot itself"),
            &room,
        ),
        "leave_if_matches must mutate only the user index"
    );
}

#[test]
fn room_registry_leave_if_matches_returns_false_for_missing_entry_absent_and_loading_slot() {
    let missing_entry_registry = RoomRegistry::<TestRoom>::new();
    let absent_room_registry = RoomRegistry::<TestRoom>::new();
    let loading_room_registry = RoomRegistry::<TestRoom>::new();
    let missing_entry_room_id = Ulid::new();
    let absent_room_id = Ulid::new();
    let loading_room_id = Ulid::new();
    let user_id = 42;
    let room = Arc::new(TestRoom);

    missing_entry_registry.insert_active_for_test(missing_entry_room_id, Arc::clone(&room));
    absent_room_registry
        .insert_user_entry_for_test(user_id, entry(absent_room_id, EntryState::Live));
    loading_room_registry.insert_loading_for_test(loading_room_id);
    loading_room_registry
        .insert_user_entry_for_test(user_id, entry(loading_room_id, EntryState::Live));

    let missing_entry_incarnation = missing_entry_registry.counters_for_test().1 - 1;
    let loading_incarnation = loading_room_registry.counters_for_test().1 - 1;

    assert!(
        !missing_entry_registry.leave_if_matches(
            user_id,
            missing_entry_room_id,
            missing_entry_incarnation
        ),
        "leave_if_matches must return false when the active room matches but the user entry is missing"
    );
    assert!(
        !absent_room_registry.leave_if_matches(user_id, absent_room_id, 1),
        "leave_if_matches must return false when the room slot is absent"
    );
    assert!(
        !loading_room_registry.leave_if_matches(user_id, loading_room_id, loading_incarnation),
        "leave_if_matches must return false when the room slot is still loading"
    );
    assert!(
        missing_entry_registry.lookup_user(user_id).is_none(),
        "leave_if_matches missing-entry false case must not create a user slot"
    );
    assert!(
        Arc::ptr_eq(
            &missing_entry_registry
                .lookup_room(missing_entry_room_id)
                .expect("leave_if_matches missing-entry false case must keep the active room"),
            &room,
        ),
        "leave_if_matches missing-entry false case must leave the active room untouched"
    );
    assert_eq!(
        absent_room_registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(absent_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "leave_if_matches absent-room false case must leave the user entry unchanged"
    );
    assert_eq!(
        loading_room_registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(loading_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "leave_if_matches loading-room false case must leave the user entry unchanged"
    );
}

#[test]
fn room_registry_mark_reserved_if_matches_returns_none_for_missing_entry_absent_and_loading_slot() {
    let missing_entry_registry = RoomRegistry::<TestRoom>::new();
    let absent_room_registry = RoomRegistry::<TestRoom>::new();
    let loading_room_registry = RoomRegistry::<TestRoom>::new();
    let missing_entry_room_id = Ulid::new();
    let absent_room_id = Ulid::new();
    let loading_room_id = Ulid::new();
    let user_id = 42;
    let room = Arc::new(TestRoom);

    missing_entry_registry.insert_active_for_test(missing_entry_room_id, Arc::clone(&room));
    absent_room_registry
        .insert_user_entry_for_test(user_id, entry(absent_room_id, EntryState::Live));
    loading_room_registry.insert_loading_for_test(loading_room_id);
    loading_room_registry
        .insert_user_entry_for_test(user_id, entry(loading_room_id, EntryState::Live));

    let missing_entry_incarnation = missing_entry_registry.counters_for_test().1 - 1;
    let loading_incarnation = loading_room_registry.counters_for_test().1 - 1;

    assert_eq!(
        missing_entry_registry.mark_reserved_if_matches(
            user_id,
            missing_entry_room_id,
            missing_entry_incarnation
        ),
        None,
        "mark_reserved_if_matches must return None when the active room matches but the user entry is missing"
    );
    assert_eq!(
        absent_room_registry.mark_reserved_if_matches(user_id, absent_room_id, 1),
        None,
        "mark_reserved_if_matches must return None when the room slot is absent"
    );
    assert_eq!(
        loading_room_registry.mark_reserved_if_matches(
            user_id,
            loading_room_id,
            loading_incarnation
        ),
        None,
        "mark_reserved_if_matches must return None when the room slot is still loading"
    );
    assert!(
        missing_entry_registry.lookup_user(user_id).is_none(),
        "mark_reserved_if_matches missing-entry None case must not create a user slot"
    );
    assert!(
        Arc::ptr_eq(
            &missing_entry_registry
                .lookup_room(missing_entry_room_id)
                .expect(
                    "mark_reserved_if_matches missing-entry None case must keep the active room"
                ),
            &room,
        ),
        "mark_reserved_if_matches missing-entry None case must leave the active room untouched"
    );
    assert_eq!(
        absent_room_registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(absent_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "mark_reserved_if_matches absent-room None case must leave the user entry unchanged"
    );
    assert_eq!(
        loading_room_registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(loading_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "mark_reserved_if_matches loading-room None case must leave the user entry unchanged"
    );
}

#[tokio::test]
async fn room_registry_leave_if_matches_noops_for_stale_incarnation_after_room_id_reuse() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_first_room, mut first_guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    let stale_incarnation = first_guard.incarnation();
    first_guard
        .commit()
        .expect("initial claim must stay committable");
    drop(first_guard);

    let _ = registry
        .destroy(room_id)
        .expect("destroy must remove the original incarnation before room-id reuse");

    let (replacement_room, mut replacement_guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("room-id reuse must create a replacement incarnation");
    replacement_guard
        .commit()
        .expect("replacement claim must stay committable");
    drop(replacement_guard);

    assert!(
        !registry.leave_if_matches(user_id, room_id, stale_incarnation),
        "leave_if_matches must no-op when given an incarnation from a destroyed room-id predecessor"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "stale leave_if_matches must preserve the replacement live claim after room-id reuse"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("stale leave_if_matches must not remove the replacement room slot"),
            &replacement_room,
        ),
        "stale leave_if_matches must leave the replacement active room published"
    );
}

#[tokio::test]
async fn room_registry_leave_if_reserved_is_aba_safe_across_destroy_and_reload() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut first_guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    first_guard
        .commit()
        .expect("initial claim must stay committable");
    drop(first_guard);
    let first_generation = registry
        .mark_reserved(user_id, room_id)
        .expect("first reservation must succeed");

    let _ = registry
        .destroy(room_id)
        .expect("destroy must remove the reserved room before reuse");

    let (_room, mut second_guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("room id reuse must create a replacement incarnation");
    second_guard
        .commit()
        .expect("replacement claim must stay committable");
    drop(second_guard);
    let second_generation = registry
        .mark_reserved(user_id, room_id)
        .expect("replacement reservation must succeed");

    assert!(
        !registry.leave_if_reserved(user_id, room_id, first_generation),
        "leave_if_reserved must not remove a replacement reservation when given a stale generation"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved {
            generation: second_generation,
        }),
        "stale leave_if_reserved must preserve the replacement reservation"
    );
    assert!(
        registry.leave_if_reserved(user_id, room_id, second_generation),
        "leave_if_reserved must remove the current reservation when the generation matches"
    );
}

#[tokio::test]
async fn room_registry_rejoin_commit_reports_claim_lost_after_destroy() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    guard.commit().expect("initial claim must stay committable");
    drop(guard);
    let generation = registry
        .mark_reserved(user_id, room_id)
        .expect("reservation setup must succeed");

    let (_room, mut rejoin_guard) = registry
        .claim_reserved(user_id, room_id, generation)
        .expect("rejoin setup must succeed");

    let _ = registry
        .destroy(room_id)
        .expect("destroy must remove the active room before rejoin commit");

    assert!(
        matches!(
            rejoin_guard.commit(),
            Err(ClaimCommitError::ClaimLost {
                room_id: lost_room_id,
                user_id: Some(lost_user_id),
            }) if lost_room_id == room_id && lost_user_id == user_id
        ),
        "destroy must invalidate an in-flight rejoin so commit returns ClaimLost"
    );
}

#[tokio::test]
async fn room_registry_stale_rejoin_guard_drop_does_not_demote_replacement_incarnation() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut first_guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");
    first_guard
        .commit()
        .expect("initial claim must stay committable");
    drop(first_guard);
    let first_generation = registry
        .mark_reserved(user_id, room_id)
        .expect("first reservation must succeed");

    let (_room, stale_rejoin_guard) = registry
        .claim_reserved(user_id, room_id, first_generation)
        .expect("stale rejoin setup must succeed");

    let _ = registry
        .destroy(room_id)
        .expect("destroy must remove the original incarnation before reuse");

    let (_replacement_room, mut replacement_guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("room id reuse must create a replacement incarnation");
    replacement_guard
        .commit()
        .expect("replacement claim must stay committable");
    drop(replacement_guard);

    drop(stale_rejoin_guard);

    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "dropping a stale rejoin guard must not demote a replacement incarnation under room-id reuse"
    );
}

#[test]
fn room_registry_leave_removes_index_entries_and_is_idempotent() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let first_room_id = Ulid::new();
    let second_room_id = Ulid::new();
    let other_user_id = 7;
    let user_id = 42;

    registry.insert_user_entry_for_test(user_id, entry(first_room_id, EntryState::Live));
    registry.insert_user_entry_for_test(
        user_id,
        entry(second_room_id, EntryState::Reserved { generation: 9 }),
    );
    registry.insert_user_entry_for_test(other_user_id, entry(first_room_id, EntryState::Live));

    assert!(
        registry.leave(user_id, first_room_id),
        "leave must remove an existing user-room index entry"
    );
    assert!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(first_room_id).map(|entry| entry.state))
            .is_none(),
        "leave must remove only the targeted room entry from the user's slot"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(second_room_id).map(|entry| entry.state)),
        Some(EntryState::Reserved { generation: 9 }),
        "leave must keep the caller's unrelated user-slot entries intact"
    );
    assert_eq!(
        registry
            .lookup_user(other_user_id)
            .and_then(|slot| slot.find(first_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "leave must not touch other users that happen to reference the same room"
    );
    assert!(
        !registry.leave(user_id, first_room_id),
        "leave must be idempotent when the targeted index entry is already gone"
    );
    assert!(
        registry.leave(user_id, second_room_id),
        "leave must still remove the last remaining room entry for the user"
    );
    assert!(
        registry.lookup_user(user_id).is_none(),
        "removing the final entry must delete the now-empty outer user slot"
    );
}

#[test]
fn room_registry_leave_does_not_touch_the_room_slot() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;
    let room = Arc::new(TestRoom);

    registry.insert_active_for_test(room_id, Arc::clone(&room));
    registry.insert_user_entry_for_test(user_id, entry(room_id, EntryState::Live));

    assert!(
        registry.leave(user_id, room_id),
        "leave must still remove the matching user index entry"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("leave must not tear down the room slot itself"),
            &room,
        ),
        "leave must remove only the index entry and leave the published room untouched"
    );
    assert_eq!(
        registry.room_count(),
        1,
        "leave must not change the number of active room slots"
    );
    assert!(
        registry.lookup_user(user_id).is_none(),
        "leave must still remove the now-empty outer user slot"
    );
}

#[tokio::test]
async fn room_registry_destroy_removes_loading_slot_and_inflight_claims() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let task_registry = Arc::clone(&registry);
    let task_allow_finish = Arc::clone(&allow_finish);
    let task = tokio::spawn(async move {
        task_registry
            .ensure_and_claim(user_id, room_id, move |_| async move {
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                task_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("loader must reach the loading phase before destroy");

    let destroyed = sorted_users(
        registry
            .destroy(room_id)
            .expect("destroy must remove an in-flight loading slot"),
    );

    assert!(
        destroyed.room.is_none(),
        "destroying a loading slot must return no published room handle"
    );
    assert_eq!(
        destroyed.users,
        vec![user_id],
        "destroy must return every user claim swept with the loading slot"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "destroy must remove the loading slot immediately"
    );
    assert!(
        registry.lookup_user(user_id).is_none(),
        "destroy must remove matching in-flight user index entries in the same lock scope"
    );

    allow_finish.notify_one();
    let result = task.await.expect("loader task must not panic");
    assert!(
        matches!(
            result,
            Err(RegistryError::LoadingAborted {
                room_id: aborted_room_id,
                user_id: Some(aborted_user_id),
            }) if aborted_room_id == room_id && aborted_user_id == user_id
        ),
        "destroying the authoritative loading slot must make the in-flight claim fail with LoadingAborted"
    );

    let retried_room = registry
        .ensure_room(room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("destroying a loading slot must leave the room id reusable immediately");
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(room_id)
                .expect("retry after destroy must publish a replacement room"),
            &retried_room,
        ),
        "destroying a loading slot must clean up enough state for a later retry to publish normally"
    );
}

#[test]
fn room_registry_destroy_loading_slot_sweeps_all_matching_user_entries() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let room_id = Ulid::new();
    let other_room_id = Ulid::new();
    let first_user_id = 42;
    let second_user_id = 43;

    registry.insert_loading_for_test(room_id);
    registry.insert_active_for_test(other_room_id, Arc::new(TestRoom));
    registry.insert_user_entry_for_test(first_user_id, entry(room_id, EntryState::Live));
    registry.insert_user_entry_for_test(second_user_id, entry(room_id, EntryState::Live));
    registry.insert_user_entry_for_test(second_user_id, entry(other_room_id, EntryState::Live));

    let destroyed = sorted_users(
        registry
            .destroy(room_id)
            .expect("destroy must remove the loading slot and all matching claims"),
    );

    assert!(
        destroyed.room.is_none(),
        "destroying a loading slot must not return a room handle"
    );
    assert_eq!(
        destroyed.users,
        vec![first_user_id, second_user_id],
        "destroy must sweep every user that still points at the loading room"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "destroy must remove the loading slot immediately"
    );
    assert!(
        registry.lookup_user(first_user_id).is_none(),
        "destroy must delete a user slot when the destroyed room was their only entry"
    );
    assert_eq!(
        registry
            .lookup_user(second_user_id)
            .and_then(|slot| slot.find(other_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "destroy must preserve unrelated user entries while sweeping the destroyed room"
    );
    assert_eq!(
        registry.room_count(),
        1,
        "destroying a loading slot must not disturb unrelated active room slots"
    );
}

#[test]
fn room_registry_destroy_removes_active_slot_and_matching_index_entries() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let room_id = Ulid::new();
    let other_room_id = Ulid::new();
    let destroyed_room = Arc::new(TestRoom);
    let first_user_id = 42;
    let second_user_id = 43;

    registry.insert_active_for_test(room_id, Arc::clone(&destroyed_room));
    registry.insert_active_for_test(other_room_id, Arc::new(TestRoom));
    registry.insert_user_entry_for_test(first_user_id, entry(room_id, EntryState::Live));
    registry.insert_user_entry_for_test(
        second_user_id,
        entry(room_id, EntryState::Reserved { generation: 5 }),
    );
    registry.insert_user_entry_for_test(second_user_id, entry(other_room_id, EntryState::Live));

    let destroyed = sorted_users(
        registry
            .destroy(room_id)
            .expect("destroy must remove an active room slot"),
    );

    assert!(
        Arc::ptr_eq(
            destroyed
                .room
                .as_ref()
                .expect("destroying an active slot must return the removed room handle"),
            &destroyed_room,
        ),
        "destroy must return the exact Arc removed from the active slot"
    );
    assert_eq!(
        destroyed.users,
        vec![first_user_id, second_user_id],
        "destroy must sweep every matching user index entry for the room"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "destroy must remove the active room slot from lookup_room"
    );
    assert!(
        registry.lookup_user(first_user_id).is_none(),
        "destroy must remove a user's outer slot when that room was their final entry"
    );
    assert_eq!(
        registry
            .lookup_user(second_user_id)
            .and_then(|slot| slot.find(other_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "destroy must preserve unrelated room entries for users who still occupy other rooms"
    );
}

#[tokio::test]
async fn room_registry_destroyed_published_claim_commits_as_claim_lost() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");

    let destroyed = registry
        .destroy(room_id)
        .expect("destroy must remove the published room before commit");
    assert!(
        destroyed.room.is_some(),
        "destroy must return the published room handle for an active slot"
    );
    assert_eq!(
        destroyed.users,
        vec![user_id],
        "destroy must return the user whose claim it removed"
    );

    assert!(
        matches!(
            guard.commit(),
            Err(ClaimCommitError::ClaimLost {
                room_id: lost_room_id,
                user_id: Some(lost_user_id),
            }) if lost_room_id == room_id && lost_user_id == user_id
        ),
        "authoritative destroy must force in-flight claim finalization to fail with ClaimLost"
    );
}

#[test]
fn room_registry_destroy_is_idempotent() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();

    registry.insert_active_for_test(room_id, Arc::new(TestRoom));

    assert!(
        registry.destroy(room_id).is_some(),
        "the first destroy must remove the existing room slot"
    );
    assert!(
        registry.destroy(room_id).is_none(),
        "destroy must be idempotent and return None after the room is already gone"
    );
}

#[tokio::test]
async fn room_registry_destroy_if_matches_noops_for_wrong_incarnation_loading_and_absence() {
    let registry = RoomRegistry::<TestRoom>::new();
    let active_room_id = Ulid::new();
    let loading_room_id = Ulid::new();
    let absent_room_id = Ulid::new();

    let (active_room, mut active_guard) = registry
        .ensure_and_claim(42, active_room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("active-room setup must succeed");
    let active_incarnation = active_guard.incarnation();
    active_guard
        .commit()
        .expect("active-room setup must leave a committable guard");
    drop(active_guard);

    assert!(
        registry
            .destroy_if_matches(active_room_id, active_incarnation + 1)
            .is_none(),
        "destroy_if_matches must ignore active rooms when the incarnation does not match"
    );
    assert!(
        Arc::ptr_eq(
            &active_room,
            &registry.lookup_room(active_room_id).expect(
                "a wrong-incarnation destroy_if_matches call must leave the active room published"
            ),
        ),
        "wrong-incarnation destroy_if_matches must not replace or remove the active room"
    );

    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();
    let loading_registry = Arc::clone(&registry);
    let loading_allow_finish = Arc::clone(&allow_finish);
    let loading_task = tokio::spawn(async move {
        loading_registry
            .ensure_room(loading_room_id, move |ctx| async move {
                started_tx
                    .send(ctx.incarnation)
                    .expect("loading test must capture exactly one incarnation");
                loading_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    let loading_incarnation = started_rx
        .await
        .expect("loading test must observe the in-flight room incarnation");
    assert!(
        registry
            .destroy_if_matches(loading_room_id, loading_incarnation)
            .is_none(),
        "destroy_if_matches must ignore loading slots even when the incarnation matches"
    );
    assert!(
        registry.destroy_if_matches(absent_room_id, 1).is_none(),
        "destroy_if_matches must return None for absent room ids"
    );

    allow_finish.notify_one();
    let loaded_room = loading_task
        .await
        .expect("loading task must not panic")
        .expect(
            "loading room must still publish after destroy_if_matches no-ops on a loading slot",
        );
    assert!(
        Arc::ptr_eq(
            &loaded_room,
            &registry
                .lookup_room(loading_room_id)
                .expect("the loading room must remain publishable after a loading-slot destroy_if_matches no-op"),
        ),
        "loading-slot destroy_if_matches no-op must leave the in-flight load intact"
    );
}

#[tokio::test]
async fn room_registry_destroy_if_matches_removes_matching_active_incarnation() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let room_id = Ulid::new();
    let other_room_id = Ulid::new();
    let user_id = 42;
    let other_user_id = 43;
    let other_room = Arc::new(TestRoom);

    let (room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("matching-incarnation setup must succeed");
    let incarnation = guard.incarnation();
    guard
        .commit()
        .expect("matching-incarnation setup must leave a committable active claim");
    drop(guard);

    registry.insert_active_for_test(other_room_id, Arc::clone(&other_room));
    registry.insert_user_entry_for_test(other_user_id, entry(other_room_id, EntryState::Live));

    let destroyed = registry
        .destroy_if_matches(room_id, incarnation)
        .expect("destroy_if_matches must remove the active room when the incarnation matches");

    assert!(
        Arc::ptr_eq(
            destroyed.room.as_ref().expect(
                "destroy_if_matches must return the removed room handle for an active slot"
            ),
            &room,
        ),
        "destroy_if_matches must return the exact active Arc it removed"
    );
    assert_eq!(
        destroyed.users,
        vec![user_id],
        "destroy_if_matches must sweep the matching room's user index entries"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "destroy_if_matches must remove the matching room slot"
    );
    assert!(
        registry.lookup_user(user_id).is_none(),
        "destroy_if_matches must remove the matching user's now-empty slot"
    );
    assert!(
        Arc::ptr_eq(
            &registry
                .lookup_room(other_room_id)
                .expect("destroy_if_matches must leave unrelated rooms published"),
            &other_room,
        ),
        "destroy_if_matches must not disturb unrelated room ids"
    );
    assert_eq!(
        registry
            .lookup_user(other_user_id)
            .and_then(|slot| slot.find(other_room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "destroy_if_matches must not disturb unrelated user index entries"
    );
}

#[tokio::test]
async fn room_registry_destroy_if_matches_stale_incarnation_preserves_replacement_room() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let stale_user_id = 42;
    let replacement_user_id = 43;

    let (_stale_room, mut stale_guard) = registry
        .ensure_and_claim(stale_user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial room setup must succeed");
    let stale_incarnation = stale_guard.incarnation();
    stale_guard
        .commit()
        .expect("initial setup must leave a committed active room");
    drop(stale_guard);

    let destroyed = registry
        .destroy(room_id)
        .expect("setup must be able to remove the original incarnation before reuse");
    assert_eq!(
        destroyed.users,
        vec![stale_user_id],
        "destroy must sweep the original user's claim before the room id is reused"
    );

    let (replacement_room, mut replacement_guard) = registry
        .ensure_and_claim(replacement_user_id, room_id, |_| async {
            Ok(Arc::new(TestRoom))
        })
        .await
        .expect("room id reuse must publish a replacement incarnation");
    replacement_guard
        .commit()
        .expect("replacement incarnation must keep a committable claim");
    drop(replacement_guard);

    assert!(
        registry
            .destroy_if_matches(room_id, stale_incarnation)
            .is_none(),
        "destroy_if_matches must not tear down a replacement incarnation when given a stale identity"
    );
    assert!(
        Arc::ptr_eq(
            &registry.lookup_room(room_id).expect(
                "the replacement room must remain published after the stale destroy attempt"
            ),
            &replacement_room,
        ),
        "destroy_if_matches must preserve the replacement room handle under room-id reuse"
    );
    assert_eq!(
        registry
            .lookup_user(replacement_user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "destroy_if_matches must preserve the replacement user's live claim under room-id reuse"
    );
}

#[tokio::test]
async fn room_registry_ensure_room_retry_after_room_loading_returns_same_arc() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let loader_calls = Arc::new(AtomicUsize::new(0));
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let first_registry = Arc::clone(&registry);
    let first_calls = Arc::clone(&loader_calls);
    let first_allow_finish = Arc::clone(&allow_finish);
    let first = tokio::spawn(async move {
        first_registry
            .ensure_room(room_id, move |_| async move {
                first_calls.fetch_add(1, Ordering::SeqCst);
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                first_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("the initial loader must reach the loading phase before the competing lookup");

    let competing = registry
        .ensure_room(room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await;
    assert!(
        matches!(competing, Err(RegistryError::RoomLoading { room_id: competing_room_id }) if competing_room_id == room_id),
        "a competing ensure_room call must report RoomLoading while the first loader still owns the slot"
    );

    allow_finish.notify_one();
    let first_room = first
        .await
        .expect("the initial loader task must not panic")
        .expect("the initial loader must publish the room successfully");

    let retried_room = registry
        .ensure_room(room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("retrying after publication must return the existing active room");

    assert!(
        Arc::ptr_eq(&retried_room, &first_room),
        "retrying after RoomLoading must return the same published Arc instead of rebuilding the room"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        1,
        "retrying after publication must not run the loader a second time"
    );
}

#[tokio::test]
async fn room_registry_ensure_and_claim_retry_after_room_loading_returns_same_arc() {
    let registry = RoomRegistry::<TestRoom, UnlimitedSlot<2>>::new();
    let room_id = Ulid::new();
    let first_user_id = 42;
    let second_user_id = 43;
    let loader_calls = Arc::new(AtomicUsize::new(0));
    let allow_finish = Arc::new(Notify::new());
    let (started_tx, started_rx) = oneshot::channel();

    let first_registry = Arc::clone(&registry);
    let first_calls = Arc::clone(&loader_calls);
    let first_allow_finish = Arc::clone(&allow_finish);
    let first = tokio::spawn(async move {
        first_registry
            .ensure_and_claim(first_user_id, room_id, move |_| async move {
                first_calls.fetch_add(1, Ordering::SeqCst);
                started_tx
                    .send(())
                    .expect("loader start signal must only be sent once");
                first_allow_finish.notified().await;
                Ok(Arc::new(TestRoom))
            })
            .await
    });

    started_rx
        .await
        .expect("the first loader must reach the loading phase before the competing call");

    let competing = registry
        .ensure_and_claim(second_user_id, room_id, |_| async {
            Ok(Arc::new(TestRoom))
        })
        .await;
    assert!(
        matches!(competing, Err(RegistryError::RoomLoading { room_id: competing_room_id }) if competing_room_id == room_id),
        "a competing ensure_and_claim call must report RoomLoading while the first loader owns the slot"
    );

    allow_finish.notify_one();
    let (first_room, mut first_guard) = first
        .await
        .expect("the initial claim task must not panic")
        .expect("the first claim must publish the room successfully");
    first_guard
        .commit()
        .expect("the first claimant must still be able to commit after publication");
    drop(first_guard);

    let (retried_room, mut second_guard) = registry
        .ensure_and_claim(second_user_id, room_id, |_| async {
            Ok(Arc::new(TestRoom))
        })
        .await
        .expect("retrying after publication must claim the existing active room");
    second_guard
        .commit()
        .expect("retrying after publication must return a committable active-room claim");
    drop(second_guard);

    assert!(
        Arc::ptr_eq(&retried_room, &first_room),
        "retrying after RoomLoading must return the same published Arc instead of rebuilding the room"
    );
    assert_eq!(
        loader_calls.load(Ordering::SeqCst),
        1,
        "retrying after publication must not re-run the loader"
    );
    assert_eq!(
        registry
            .lookup_user(second_user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "retrying after publication must leave the second user's claim live in the existing room"
    );
}

#[tokio::test]
async fn room_registry_ensure_and_claim_load_failed_rolls_back_loading_slot_and_user_claim() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let result = registry
        .ensure_and_claim(user_id, room_id, |_| async move {
            Err(anyhow!("loader failed"))
        })
        .await;

    assert!(
        matches!(result, Err(RegistryError::LoadFailed { room_id: id, user_id: Some(claim_user_id), .. }) if id == room_id && claim_user_id == user_id),
        "loader errors must surface as LoadFailed with the claiming user id"
    );
    assert!(
        registry.lookup_room(room_id).is_none(),
        "a failed loader must not publish the room"
    );
    assert_eq!(
        registry.room_count(),
        0,
        "a failed loader must not leave a loading slot behind"
    );
    assert!(
        registry.lookup_user(user_id).is_none(),
        "a failed loader must roll back the provisional user claim"
    );
    assert_eq!(
        registry.user_room_count(user_id),
        0,
        "a failed loader must leave no structural user entries behind"
    );

    let (retried_room, mut retried_guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("a later claim must be able to retry after loader failure cleanup");
    retried_guard
        .commit()
        .expect("the retried claim must commit after successful publication");
    drop(retried_guard);

    assert!(
        Arc::ptr_eq(
            &retried_room,
            &registry
                .lookup_room(room_id)
                .expect("retry after loader failure must publish the room"),
        ),
        "retrying after a failed load must publish the newly created room"
    );
}

#[tokio::test]
async fn room_registry_claim_guard_commit_succeeds_after_publication_and_preserves_live_claim() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");

    assert!(
        Arc::ptr_eq(
            &room,
            &registry
                .lookup_room(room_id)
                .expect("ensure_and_claim must return only after publication succeeds"),
        ),
        "the returned room must already be the published active room"
    );
    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "successful publication must leave the claimed user entry live before commit"
    );

    guard
        .commit()
        .expect("commit must succeed while the active slot and live claim still match");
    drop(guard);

    assert_eq!(
        registry
            .lookup_user(user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "dropping a committed guard must leave the live claim intact"
    );
    assert!(
        Arc::ptr_eq(
            &room,
            &registry
                .lookup_room(room_id)
                .expect("dropping a committed guard must not remove the active room"),
        ),
        "dropping a committed guard must be a no-op for the published room"
    );
}

#[tokio::test]
async fn room_registry_claim_guard_commit_reports_claim_lost_after_room_is_destroyed() {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let user_id = 42;

    let (_room, mut guard) = registry
        .ensure_and_claim(user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");

    registry.destroy_room_for_test(room_id);

    assert!(
        matches!(
            guard.commit(),
            Err(ClaimCommitError::ClaimLost {
                room_id: id,
                user_id: Some(claim_user_id),
            }) if id == room_id && claim_user_id == user_id
        ),
        "commit must fail with ClaimLost instead of reporting success for a destroyed claim"
    );

    drop(guard);

    assert!(
        registry.lookup_user(user_id).is_none(),
        "dropping a stale fresh-join guard must clean up only its own surviving claim state"
    );
}

#[tokio::test]
async fn room_registry_stale_claim_guard_drop_does_not_remove_replacement_claim_after_room_id_reuse()
 {
    let registry = RoomRegistry::<TestRoom>::new();
    let room_id = Ulid::new();
    let stale_user_id = 42;
    let replacement_user_id = 43;

    let (_stale_room, stale_guard) = registry
        .ensure_and_claim(stale_user_id, room_id, |_| async { Ok(Arc::new(TestRoom)) })
        .await
        .expect("initial claim must succeed");

    registry.destroy_room_for_test(room_id);
    assert!(
        registry.lookup_user(stale_user_id).is_none(),
        "authoritative slot removal must sweep the stale claimant's index entry before room id reuse"
    );

    let (replacement_room, mut replacement_guard) = registry
        .ensure_and_claim(replacement_user_id, room_id, |_| async {
            Ok(Arc::new(TestRoom))
        })
        .await
        .expect("room id reuse must create a replacement incarnation");

    drop(stale_guard);

    replacement_guard
        .commit()
        .expect("dropping a stale guard must not break the replacement claim");
    drop(replacement_guard);

    assert!(
        Arc::ptr_eq(
            &replacement_room,
            &registry
                .lookup_room(room_id)
                .expect("the replacement incarnation must remain published"),
        ),
        "dropping a stale guard must not remove the replacement room incarnation"
    );
    assert_eq!(
        registry
            .lookup_user(replacement_user_id)
            .and_then(|slot| slot.find(room_id).map(|entry| entry.state)),
        Some(EntryState::Live),
        "dropping a stale guard must not remove a replacement user's live claim"
    );
    assert!(
        registry.lookup_user(stale_user_id).is_none(),
        "stale claimant state must stay gone after authoritative removal and replacement publication"
    );
}
