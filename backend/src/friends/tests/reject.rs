use crate::utils::mock;
use salvo::http::StatusCode;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// POST /api/friends/reject/{id} — asserts 200.
    pub async fn reject_friend_request(&mut self, request_id: i32) {
        let res = self.try_reject_friend_request(request_id).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "reject_friend_request should succeed: {self}"
        );
    }

    /// POST /api/friends/reject/{id} — returns raw response without asserting.
    pub async fn try_reject_friend_request(&mut self, request_id: i32) -> salvo::Response {
        let req = self
            .client
            .post(format!("/api/friends/reject/{request_id}"));
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reject_request_succeeds() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.reject_friend_request(req.id).await;
}

#[tokio::test]
async fn reject_request_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| c.post("/api/friends/reject/1"))
        .await;
}

#[tokio::test]
async fn reject_request_not_found_rejected() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let res = alice.try_reject_friend_request(999_999).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "rejecting non-existent request must return 404"
    );
}

#[tokio::test]
async fn reject_request_by_sender_forbidden() {
    // Only the receiver can reject; the sender cannot.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    let res = alice.try_reject_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "sender must not be allowed to reject their own request"
    );
}

#[tokio::test]
async fn reject_request_by_third_party_forbidden() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;
    let mut charlie = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    let res = charlie.try_reject_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "third party must not be allowed to reject the request"
    );
}

#[tokio::test]
async fn reject_request_already_accepted_conflict() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let res = bob.try_reject_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::CONFLICT),
        "rejecting an already-accepted request must return 409"
    );
}

#[tokio::test]
async fn reject_request_removes_from_incoming() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.reject_friend_request(req.id).await;

    let incoming = bob.incoming_requests().await;
    assert!(
        incoming.is_empty(),
        "bob's incoming requests must be empty after rejecting"
    );

    let outgoing = alice.outgoing_requests().await;
    assert!(
        outgoing.is_empty(),
        "alice's outgoing requests must be empty after rejection"
    );
}

#[tokio::test]
async fn reject_request_does_not_create_friendship() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.reject_friend_request(req.id).await;

    let alice_friends = alice.get_friends().await;
    let bob_friends = bob.get_friends().await;

    assert!(
        alice_friends.is_empty(),
        "alice must have no friends after rejection"
    );
    assert!(
        bob_friends.is_empty(),
        "bob must have no friends after rejection"
    );
}
