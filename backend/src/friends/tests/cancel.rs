use crate::utils::mock;
use salvo::http::StatusCode;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// DELETE /api/friends/request/{id} — asserts 200.
    pub async fn cancel_friend_request(&mut self, request_id: i32) {
        let res = self.try_cancel_friend_request(request_id).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "cancel_friend_request should succeed: {self}"
        );
    }

    /// DELETE /api/friends/request/{id} — returns raw response without asserting.
    pub async fn try_cancel_friend_request(&mut self, request_id: i32) -> salvo::Response {
        let req = self
            .client
            .delete(format!("/api/friends/request/{request_id}"));
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn cancel_request_succeeds() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    alice.cancel_friend_request(req.id).await;
}

#[tokio::test]
async fn cancel_request_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| c.delete("/api/friends/request/1"))
        .await;
}

#[tokio::test]
async fn cancel_request_not_found_rejected() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let res = alice.try_cancel_friend_request(999_999).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "cancelling non-existent request must return 404"
    );
}

#[tokio::test]
async fn cancel_request_by_receiver_forbidden() {
    // Only the sender can cancel; the receiver cannot.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    let res = bob.try_cancel_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "receiver must not be allowed to cancel a request they received"
    );
}

#[tokio::test]
async fn cancel_request_by_third_party_forbidden() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;
    let mut charlie = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    let res = charlie.try_cancel_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "third party must not be allowed to cancel the request"
    );
}

#[tokio::test]
async fn cancel_request_already_accepted_conflict() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let res = alice.try_cancel_friend_request(req.id).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::CONFLICT),
        "cancelling an already-accepted request must return 409"
    );
}

#[tokio::test]
async fn cancel_request_removes_from_outgoing() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    alice.cancel_friend_request(req.id).await;

    let outgoing = alice.outgoing_requests().await;
    assert!(
        outgoing.is_empty(),
        "alice's outgoing requests must be empty after cancelling"
    );
}

#[tokio::test]
async fn cancel_request_removes_from_incoming() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    alice.cancel_friend_request(req.id).await;

    let incoming = bob.incoming_requests().await;
    assert!(
        incoming.is_empty(),
        "bob's incoming requests must be empty after alice cancels"
    );
}

#[tokio::test]
async fn cancel_allows_resending_afterwards() {
    // After cancelling, the sender should be able to send a new request.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    alice.cancel_friend_request(req.id).await;

    // Should succeed — unique constraint no longer blocks it.
    let new_req = alice.send_friend_request_to(bob.user_id()).await;
    assert!(new_req.id > 0, "re-sent request must have a valid id");
    assert_ne!(new_req.id, req.id, "re-sent request must have a new id");
}
