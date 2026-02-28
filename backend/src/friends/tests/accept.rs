use crate::friends::types::FriendRequestResponse;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// POST /api/friends/accept/{id} — asserts 200, returns parsed response.
    pub async fn accept_friend_request(&mut self, request_id: i32) -> FriendRequestResponse {
        let mut res = self.try_accept_friend_request(request_id).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "accept_friend_request should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// POST /api/friends/accept/{id} — returns raw response without asserting.
    pub async fn try_accept_friend_request(&mut self, request_id: i32) -> salvo::Response {
        let req = self
            .client
            .post(format!("/api/friends/accept/{request_id}"));
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn accept_request_succeeds() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    let res = bob.accept_friend_request(req.id).await;

    assert_eq!(res.status, "accepted");
    assert_eq!(res.id, req.id);
    assert_eq!(res.sender.id, alice.user_id());
    assert_eq!(res.receiver.id, bob.user_id());
}

#[tokio::test]
async fn accept_request_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.post("/api/friends/accept/1")).await;
}

#[tokio::test]
async fn accept_request_not_found_rejected() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let res = alice.try_accept_friend_request(999_999).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "accepting non-existent request must return 404"
    );
}

#[tokio::test]
async fn accept_request_by_sender_forbidden() {
    // The sender of a request cannot accept their own request.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let _bob = server.user().register().await;

    let req = alice.send_friend_request_to(_bob.user_id()).await;
    let res = alice.try_accept_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "sender must not be allowed to accept their own request"
    );
}

#[tokio::test]
async fn accept_request_by_third_party_forbidden() {
    // A user unrelated to the request cannot accept it.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;
    let mut charlie = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    let res = charlie.try_accept_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "third party must not be allowed to accept the request"
    );
}

#[tokio::test]
async fn accept_request_already_accepted_conflict() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    // Try to accept again.
    let res = bob.try_accept_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::CONFLICT),
        "accepting an already-accepted request must return 409"
    );
}

#[tokio::test]
async fn accept_request_friendship_appears_in_list() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let alice_friends = alice.get_friends().await;
    let bob_friends = bob.get_friends().await;

    assert!(
        alice_friends.iter().any(|f| f.id == bob.user_id()),
        "bob must appear in alice's friend list after accepting"
    );
    assert!(
        bob_friends.iter().any(|f| f.id == alice.user_id()),
        "alice must appear in bob's friend list after accepting"
    );
}
