use crate::routers::users::PublicUser;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// GET /api/friends — asserts 200, returns parsed list.
    pub async fn get_friends(&mut self) -> Vec<PublicUser> {
        let mut res = self.try_get_friends().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "get_friends should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// GET /api/friends — returns raw response without asserting.
    pub async fn try_get_friends(&mut self) -> salvo::Response {
        let req = self.client.get("/api/friends");
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn list_friends_empty_initially() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let friends = alice.get_friends().await;

    assert!(friends.is_empty(), "new user must have no friends");
}

#[tokio::test]
async fn list_friends_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.get("/api/friends")).await;
}

#[tokio::test]
async fn list_friends_shows_accepted_friend() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let friends = alice.get_friends().await;
    assert_eq!(friends.len(), 1, "alice must see exactly one friend");
    assert_eq!(friends[0].id, bob.user_id());
}

#[tokio::test]
async fn list_friends_excludes_pending_requests() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    alice.send_friend_request_to(bob.user_id()).await;

    // Pending request must not appear as a friend.
    let alice_friends = alice.get_friends().await;
    assert!(
        alice_friends.is_empty(),
        "pending request must not appear in friends list"
    );
}

#[tokio::test]
async fn list_friends_bidirectional_sender_sees_friend() {
    // Alice sends the request; after acceptance, Alice also sees Bob.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let alice_friends = alice.get_friends().await;
    assert!(
        alice_friends.iter().any(|f| f.id == bob.user_id()),
        "bob must appear in alice's friend list (sender perspective)"
    );
}

#[tokio::test]
async fn list_friends_bidirectional_receiver_sees_friend() {
    // Bob received the request; after acceptance, Bob also sees Alice.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let bob_friends = bob.get_friends().await;
    assert!(
        bob_friends.iter().any(|f| f.id == alice.user_id()),
        "alice must appear in bob's friend list (receiver perspective)"
    );
}

#[tokio::test]
async fn list_friends_multiple_friends() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;
    let mut charlie = server.user().register().await;

    let req1 = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req1.id).await;

    let req2 = alice.send_friend_request_to(charlie.user_id()).await;
    charlie.accept_friend_request(req2.id).await;

    let friends = alice.get_friends().await;
    assert_eq!(friends.len(), 2, "alice must see two friends");

    let ids: Vec<i32> = friends.iter().map(|f| f.id).collect();
    assert!(ids.contains(&bob.user_id()));
    assert!(ids.contains(&charlie.user_id()));
}

#[tokio::test]
async fn list_friends_removed_after_unfriend() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    alice.remove_friend(bob.user_id()).await;

    let friends = alice.get_friends().await;
    assert!(
        friends.is_empty(),
        "bob must disappear from alice's list after unfriending"
    );
}

#[tokio::test]
async fn list_friends_does_not_leak_sensitive_data() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let mut res = alice.try_get_friends().await;
    let body = res.take_string().await.unwrap();

    assert!(
        !body.contains("password_hash"),
        "friend list must not leak password_hash"
    );
    assert!(
        !body.contains("totp_secret_enc"),
        "friend list must not leak totp_secret_enc"
    );
}
