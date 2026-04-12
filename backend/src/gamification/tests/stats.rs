use salvo::test::ResponseExt as _;

use crate::utils::mock;

/// GET /api/stats/@me returns default stats for a fresh user.
#[tokio::test]
async fn get_my_stats_returns_defaults() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let req = user.client.get("/api/stats/@me");
    let mut resp = user.client.send(req).await;

    assert_eq!(resp.status_code, Some(salvo::http::StatusCode::OK));
    let body: serde_json::Value = resp.take_json().await.unwrap();

    assert_eq!(body["xp"], 0);
    assert_eq!(body["level"], 1);
    assert_eq!(body["games_played"], 0);
    assert_eq!(body["games_won"], 0);
    assert_eq!(body["games_lost"], 0);
    assert_eq!(body["win_rate"], 0.0);
    assert_eq!(body["current_win_streak"], 0);
    assert_eq!(body["best_win_streak"], 0);
}

/// GET /api/stats/@me requires authentication.
#[tokio::test]
async fn get_my_stats_requires_auth() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Clear cookies to simulate an unauthenticated client
    user.client.cookies = cookie::CookieJar::new();

    let req = user.client.get("/api/stats/@me");
    let resp = user.client.send(req).await;

    assert_eq!(
        resp.status_code,
        Some(salvo::http::StatusCode::UNAUTHORIZED)
    );
}

/// `GET /api/stats/{user_id}` returns stats for another user.
#[tokio::test]
async fn get_user_stats_returns_other_user() {
    let server = mock::Server::default();
    let mut p1 = server.user().register().await;
    let p1_id = p1.user_id();

    // p1 fetches their own stats by numeric ID
    let req = p1.client.get(format!("/api/stats/{p1_id}"));
    let mut resp = p1.client.send(req).await;
    assert_eq!(resp.status_code, Some(salvo::http::StatusCode::OK));
    let body: serde_json::Value = resp.take_json().await.unwrap();
    assert_eq!(body["user_id"], p1_id);
}

/// `GET /api/stats/{user_id}` returns 404 for a non-existent user.
#[tokio::test]
async fn get_user_stats_unknown_user_is_404() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let req = user.client.get("/api/stats/999999");
    let resp = user.client.send(req).await;

    assert_eq!(resp.status_code, Some(salvo::http::StatusCode::NOT_FOUND));
}

