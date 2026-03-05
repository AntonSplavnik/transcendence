use crate::auth::user::UpdateDescriptionInput;
use crate::utils::mock;
use salvo::http::StatusCode;

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `PUT /api/user/description` — update the user's description, asserting 200 OK.
    pub async fn update_description(&mut self, new_desc: &str) {
        let res = self.try_update_description(new_desc).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "update_description should succeed: {self}"
        );
    }

    /// `PUT /api/user/description` without asserting the outcome.
    pub async fn try_update_description(&mut self, new_desc: &str) -> salvo::Response {
        let body = UpdateDescriptionInput {
            description: new_desc.to_string(),
        };
        let req = self.client.put("/api/user/description").json(&body);
        self.client.send(req).await
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn update_description_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.update_description("Hello world!").await;
}

#[tokio::test]
async fn update_description_persists_in_me() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    user.update_description("My cool description").await;

    let info = user.me().await;
    assert_eq!(info.user.description, "My cool description");
}

#[tokio::test]
async fn update_description_empty_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    user.update_description("something").await;
    user.update_description("").await;

    let info = user.me().await;
    assert_eq!(info.user.description, "");
}

#[tokio::test]
async fn update_description_exact_max_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let desc = "a".repeat(50);
    user.update_description(&desc).await;

    let info = user.me().await;
    assert_eq!(info.user.description, desc);
}

#[tokio::test]
async fn update_description_above_max_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user.try_update_description(&"a".repeat(51)).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "description longer than 50 chars must be rejected"
    );
}

#[tokio::test]
async fn update_description_multibyte_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // 50 emojis = 50 chars (200 bytes) — must be accepted
    let desc = "🎮".repeat(50);
    user.update_description(&desc).await;

    let info = user.me().await;
    assert_eq!(info.user.description, desc);
}

#[tokio::test]
async fn update_description_multibyte_above_max_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // 51 emojis = 51 chars — must be rejected
    let res = user.try_update_description(&"🎮".repeat(51)).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "51 emoji chars must be rejected"
    );
}

#[tokio::test]
async fn update_description_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| {
        c.put("/api/user/description")
            .json(&UpdateDescriptionInput {
                description: "test".to_string(),
            })
    })
    .await;
}

#[tokio::test]
async fn default_description_is_empty() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.me().await;
    assert_eq!(
        info.user.description, "",
        "new user should have empty description"
    );
}
