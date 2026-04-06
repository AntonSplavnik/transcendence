use crate::friends::types::{FriendRequestResponse, SendFriendRequestInput};
use crate::models::{FriendRequestStatus, nickname::Nickname};
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ──────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// POST /api/friends/request by `user_id` — asserts 200, returns parsed response.
    pub async fn send_friend_request_to(&mut self, target_id: i32) -> FriendRequestResponse {
        let input = SendFriendRequestInput {
            user_id: Some(target_id),
            nickname: None,
        };
        let mut res = self.try_send_friend_request(&input).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "send_friend_request should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// POST /api/friends/request by nickname — asserts 200, returns parsed response.
    pub async fn send_friend_request_to_nick(&mut self, nick: Nickname) -> FriendRequestResponse {
        let input = SendFriendRequestInput {
            user_id: None,
            nickname: Some(nick),
        };
        let mut res = self.try_send_friend_request(&input).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "send_friend_request_by_nick should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// POST /api/friends/request — returns raw response without asserting.
    pub async fn try_send_friend_request(
        &mut self,
        input: &SendFriendRequestInput,
    ) -> salvo::Response {
        let req = self.client.post("/api/friends/request").json(input);
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn send_request_by_id_succeeds() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let res = alice.send_friend_request_to(bob.user_id()).await;

    assert_eq!(res.sender.id, alice.user_id());
    assert_eq!(res.receiver.id, bob.user_id());
    assert_eq!(res.status, FriendRequestStatus::Pending);
}

#[tokio::test]
async fn send_request_by_nickname_succeeds() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let res = alice.send_friend_request_to_nick(bob.nickname).await;

    assert_eq!(res.sender.id, alice.user_id());
    assert_eq!(res.receiver.id, bob.user_id());
    assert_eq!(res.status, FriendRequestStatus::Pending);
}

#[tokio::test]
async fn send_request_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| c.post("/api/friends/request"))
        .await;
}

#[tokio::test]
async fn send_request_to_self_rejected() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let input = SendFriendRequestInput {
        user_id: Some(alice.user_id()),
        nickname: None,
    };
    let res = alice.try_send_friend_request(&input).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "self-request must be rejected with 400"
    );
}

#[tokio::test]
async fn send_request_unknown_user_id_not_found() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let input = SendFriendRequestInput {
        user_id: Some(999_999),
        nickname: None,
    };
    let res = alice.try_send_friend_request(&input).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "unknown user_id must return 404"
    );
}

#[tokio::test]
async fn send_request_unknown_nickname_not_found() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    // Use a nickname from the generator — this user is never registered.
    let ghost_nick = server.user().nickname;
    let input = SendFriendRequestInput {
        user_id: None,
        nickname: Some(ghost_nick),
    };
    let res = alice.try_send_friend_request(&input).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NOT_FOUND),
        "unknown nickname must return 404"
    );
}

#[tokio::test]
async fn send_request_no_identifier_rejected() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;

    let input = SendFriendRequestInput {
        user_id: None,
        nickname: None,
    };
    let res = alice.try_send_friend_request(&input).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "request without user_id or nickname must be rejected with 400"
    );
}

#[tokio::test]
async fn send_request_duplicate_rejected() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    alice.send_friend_request_to(bob.user_id()).await;

    let input = SendFriendRequestInput {
        user_id: Some(bob.user_id()),
        nickname: None,
    };
    let res = alice.try_send_friend_request(&input).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "duplicate friend request must be rejected with 400"
    );
}

#[tokio::test]
async fn send_request_reverse_duplicate_rejected() {
    // Bob sends to Alice first; then Alice tries to send to Bob.
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    bob.send_friend_request_to(alice.user_id()).await;

    let input = SendFriendRequestInput {
        user_id: Some(bob.user_id()),
        nickname: None,
    };
    let res = alice.try_send_friend_request(&input).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "cross-direction duplicate friend request must be rejected with 400"
    );
}

#[tokio::test]
async fn send_request_already_friends_rejected() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let mut bob = server.user().register().await;

    let req = alice.send_friend_request_to(bob.user_id()).await;
    bob.accept_friend_request(req.id).await;

    let input = SendFriendRequestInput {
        user_id: Some(bob.user_id()),
        nickname: None,
    };
    let res = alice.try_send_friend_request(&input).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "sending request to existing friend must be rejected with 400"
    );
}

#[tokio::test]
async fn send_request_response_has_correct_ids() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let res = alice.send_friend_request_to(bob.user_id()).await;

    assert!(res.id > 0, "request id must be positive");
    assert_eq!(res.sender.id, alice.user_id());
    assert_eq!(res.receiver.id, bob.user_id());
    assert_eq!(res.sender.nickname.to_string(), alice.nickname.to_string());
    assert_eq!(res.receiver.nickname.to_string(), bob.nickname.to_string());
}

#[tokio::test]
async fn send_request_response_does_not_leak_sensitive_data() {
    let server = mock::Server::default();
    let mut alice = server.user().register().await;
    let bob = server.user().register().await;

    let input = SendFriendRequestInput {
        user_id: Some(bob.user_id()),
        nickname: None,
    };
    let mut res = alice.try_send_friend_request(&input).await;
    let body = res.take_string().await.unwrap();

    assert!(
        !body.contains("password_hash"),
        "response must not leak password_hash"
    );
    assert!(
        !body.contains("totp_secret_enc"),
        "response must not leak totp_secret_enc"
    );
}
