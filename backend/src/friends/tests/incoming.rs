use crate::friends::types::FriendRequestResponse;
use crate::models::FriendRequestStatus;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// GET /api/friends/requests/incoming — asserts 200, returns parsed list.
    pub async fn incoming_requests(&mut self) -> Vec<FriendRequestResponse> {
        let mut res = self.try_incoming_requests().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "incoming_requests should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// GET /api/friends/requests/incoming — returns raw response without asserting.
    pub async fn try_incoming_requests(&mut self) -> salvo::Response {
        let req = self.client.get("/api/friends/requests/incoming");
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn incoming_requests_empty_initially() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let incoming = alice.incoming_requests().await;

    assert!(
        incoming.is_empty(),
        "new user must have no incoming requests"
    );
}

#[tokio::test]
async fn incoming_requests_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.get("/api/friends/requests/incoming"))
        .await;
}

#[tokio::test]
async fn incoming_requests_shows_pending_request() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;

    let incoming = bob.incoming_requests().await;
    assert_eq!(incoming.len(), 1, "bob must see one incoming request");
    assert_eq!(incoming[0].id, req.id);
    assert_eq!(incoming[0].sender.id, alice.user_id());
    assert_eq!(incoming[0].receiver.id, bob.user_id());
    assert_eq!(incoming[0].status, FriendRequestStatus::PENDING);
}

#[tokio::test]
async fn incoming_requests_excludes_own_sent_requests() {
    // Requests sent by alice should not appear in alice's incoming list.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    alice.send_friend_request_to(bob.user_id()).await;

    let incoming = alice.incoming_requests().await;
    assert!(
        incoming.is_empty(),
        "outgoing requests must not appear in sender's incoming list"
    );
}

#[tokio::test]
async fn incoming_requests_excludes_accepted() {
    // Once a request is accepted, it must not appear in incoming.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let incoming = bob.incoming_requests().await;
    assert!(
        incoming.is_empty(),
        "accepted request must not appear in incoming list"
    );
}

#[tokio::test]
async fn incoming_requests_multiple_senders() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;
    let mut charlie = server.user().register().await;

    alice.send_friend_request_to(charlie.user_id()).await;
    bob.send_friend_request_to(charlie.user_id()).await;

    let incoming = charlie.incoming_requests().await;
    assert_eq!(incoming.len(), 2, "charlie must see two incoming requests");

    let sender_ids: Vec<i32> = incoming.iter().map(|r| r.sender.id).collect();
    assert!(sender_ids.contains(&alice.user_id()));
    assert!(sender_ids.contains(&bob.user_id()));
}

#[tokio::test]
async fn incoming_requests_disappears_after_cancel() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    alice.cancel_friend_request(req.id).await;

    let incoming = bob.incoming_requests().await;
    assert!(
        incoming.is_empty(),
        "cancelled request must disappear from receiver's incoming list"
    );
}
