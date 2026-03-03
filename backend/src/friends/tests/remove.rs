use crate::models::FriendRequestStatus;
use crate::utils::mock;
use salvo::http::StatusCode;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// DELETE /api/friends/remove/{user_id} — asserts 200.
    pub async fn remove_friend(&mut self, friend_id: i32) {
        let res = self.try_remove_friend(friend_id).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "remove_friend should succeed: {self}"
        );
    }

    /// DELETE /api/friends/remove/{user_id} — returns raw response without asserting.
    pub async fn try_remove_friend(&mut self, friend_id: i32) -> salvo::Response {
        let req = self
            .client
            .delete(format!("/api/friends/remove/{friend_id}"));
        self.client.send(req).await
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Register two users, make them friends (alice sends, bob accepts), return both.
async fn make_friends(
    server: &mock::Server,
) -> (mock::User<mock::Registered>, mock::User<mock::Registered>) {
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;
    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;
    (alice, bob)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn remove_friend_succeeds() {
    let server = mock::Server::default();
    let (mut alice, _bob) = make_friends(&server).await;
    alice.remove_friend(_bob.user_id()).await;
}

#[tokio::test]
async fn remove_friend_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.delete("/api/friends/remove/1"))
        .await;
}

#[tokio::test]
async fn remove_friend_not_friends_not_found() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let res = alice.try_remove_friend(bob.user_id()).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "removing a non-friend must return 404"
    );
}

#[tokio::test]
async fn remove_friend_removes_from_both_lists() {
    let server = mock::Server::default();
    let (mut alice, mut bob) = make_friends(&server).await;

    alice.remove_friend(bob.user_id()).await;

    let alice_friends = alice.get_friends().await;
    let bob_friends = bob.get_friends().await;

    assert!(
        alice_friends.is_empty(),
        "alice must have no friends after removing bob"
    );
    assert!(
        bob_friends.is_empty(),
        "bob must have no friends after alice removes him"
    );
}

#[tokio::test]
async fn remove_friend_bidirectional_sender_removes() {
    // Alice (sender) removes — should work.
    let server = mock::Server::default();
    let (mut alice, bob) = make_friends(&server).await;
    alice.remove_friend(bob.user_id()).await;

    assert!(
        alice.get_friends().await.is_empty(),
        "friendship must be gone after sender removes"
    );
}

#[tokio::test]
async fn remove_friend_bidirectional_receiver_removes() {
    // Bob (receiver of original request) also can remove.
    let server = mock::Server::default();
    let (alice, mut bob) = make_friends(&server).await;
    bob.remove_friend(alice.user_id()).await;

    assert!(
        bob.get_friends().await.is_empty(),
        "friendship must be gone after receiver removes"
    );
}

#[tokio::test]
async fn remove_friend_allows_new_request_afterwards() {
    // After removing, it should be possible to send a new friend request.
    let server = mock::Server::default();
    let (mut alice, bob) = make_friends(&server).await;
    alice.remove_friend(bob.user_id()).await;

    let new_req = alice.send_friend_request_to(bob.user_id()).await;
    assert!(
        new_req.id > 0,
        "new friend request must be created after removal"
    );
    assert_eq!(new_req.status, FriendRequestStatus::PENDING);
}

#[tokio::test]
async fn remove_friend_pending_request_not_found() {
    // A pending request is not a friendship — remove must fail.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    alice.send_friend_request_to(bob.user_id()).await;

    let res = alice.try_remove_friend(bob.user_id()).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "pending request must not count as a friendship for removal"
    );
}

#[tokio::test]
async fn remove_friend_unknown_user_not_found() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let res = alice.try_remove_friend(999_999).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "removing unknown user must return 404"
    );
}
