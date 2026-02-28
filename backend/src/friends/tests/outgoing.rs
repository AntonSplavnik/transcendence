use crate::friends::types::FriendRequestResponse;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// GET /api/friends/requests/outgoing — asserts 200, returns parsed list.
    pub async fn outgoing_requests(&mut self) -> Vec<FriendRequestResponse> {
        let mut res = self.try_outgoing_requests().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "outgoing_requests should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// GET /api/friends/requests/outgoing — returns raw response without asserting.
    pub async fn try_outgoing_requests(&mut self) -> salvo::Response {
        let req = self.client.get("/api/friends/requests/outgoing");
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn outgoing_requests_empty_initially() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let outgoing = alice.outgoing_requests().await;

    assert!(
        outgoing.is_empty(),
        "new user must have no outgoing requests"
    );
}

#[tokio::test]
async fn outgoing_requests_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.get("/api/friends/requests/outgoing"))
        .await;
}

#[tokio::test]
async fn outgoing_requests_shows_pending_request() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;

    let outgoing = alice.outgoing_requests().await;
    assert_eq!(outgoing.len(), 1, "alice must see one outgoing request");
    assert_eq!(outgoing[0].id, req.id);
    assert_eq!(outgoing[0].sender.id, alice.user_id());
    assert_eq!(outgoing[0].receiver.id, bob.user_id());
    assert_eq!(outgoing[0].status, "pending");
}

#[tokio::test]
async fn outgoing_requests_excludes_received_requests() {
    // Requests received by alice must not appear in alice's outgoing list.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    bob.send_friend_request_to(alice.user_id()).await;

    let outgoing = alice.outgoing_requests().await;
    assert!(
        outgoing.is_empty(),
        "incoming requests must not appear in receiver's outgoing list"
    );
}

#[tokio::test]
async fn outgoing_requests_excludes_accepted() {
    // Once a request is accepted, it must not appear in outgoing.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let outgoing = alice.outgoing_requests().await;
    assert!(
        outgoing.is_empty(),
        "accepted request must not appear in outgoing list"
    );
}

#[tokio::test]
async fn outgoing_requests_multiple_receivers() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;
    let charlie = server.user().register().await;

    alice.send_friend_request_to(bob.user_id()).await;
    alice.send_friend_request_to(charlie.user_id()).await;

    let outgoing = alice.outgoing_requests().await;
    assert_eq!(outgoing.len(), 2, "alice must see two outgoing requests");

    let receiver_ids: Vec<i32> = outgoing.iter().map(|r| r.receiver.id).collect();
    assert!(receiver_ids.contains(&bob.user_id()));
    assert!(receiver_ids.contains(&charlie.user_id()));
}

#[tokio::test]
async fn outgoing_requests_disappears_after_cancel() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    alice.cancel_friend_request(req.id).await;

    let outgoing = alice.outgoing_requests().await;
    assert!(
        outgoing.is_empty(),
        "cancelled request must disappear from outgoing list"
    );
}

#[tokio::test]
async fn outgoing_requests_disappears_after_rejection() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.reject_friend_request(req.id).await;

    let outgoing = alice.outgoing_requests().await;
    assert!(
        outgoing.is_empty(),
        "rejected request must disappear from sender's outgoing list"
    );
}
