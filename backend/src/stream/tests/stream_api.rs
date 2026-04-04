use crate::utils::mock;
use salvo::http::StatusCode;

use super::super::stream_manager::PendingConnectionKey;

impl mock::User<mock::Registered> {
    /// `POST /api/stream/bind` — bind a pending WebTransport connection key.
    pub async fn bind_pending_stream(&mut self, key: &PendingConnectionKey) {
        let res = self.try_bind_pending_stream(key).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "valid pending connection key must bind successfully"
        );
    }

    /// `POST /api/stream/bind` without asserting status.
    pub async fn try_bind_pending_stream(&mut self, key: &PendingConnectionKey) -> salvo::Response {
        let req = self.client.post("/api/stream/bind").json(key);
        self.client.send(req).await
    }
}

#[tokio::test]
async fn bind_pending_stream_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    let key = PendingConnectionKey::new(1);

    user.assert_requires_auth(|c| c.post("/api/stream/bind").json(&key))
        .await;
}

#[tokio::test]
async fn bind_pending_stream_invalid_key_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let key = PendingConnectionKey::new(999_999);

    let res = user.try_bind_pending_stream(&key).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "invalid or expired pending connection key must be rejected"
    );
}

#[tokio::test]
async fn bind_pending_stream_tos_bump_forbidden_until_reaccepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let future_tos = crate::tos::CurrentTosTimestamp::from_utc(
        chrono::Utc::now() + chrono::Duration::seconds(2),
    );
    let bumped_server = server.with_tos(future_tos);
    user.client = user.client.rebind(&bumped_server);

    let key = PendingConnectionKey::new(7);
    let res = user.try_bind_pending_stream(&key).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "stream bind must be blocked by ToS gate after ToS version bump"
    );
}
