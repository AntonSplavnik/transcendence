use salvo::test::ResponseExt as _;

use crate::{db::Database as _, utils::mock};

/// Insert a game and verify both players' stats are updated.
#[tokio::test]
async fn record_game_updates_stats() {
    let server = mock::Server::default();

    let p1 = server.user().register().await;
    let p2 = server.user().register().await;
    let p1_id = p1.user_id();
    let p2_id = p2.user_id();

    let (game, stats1, stats2) = server
        .db
        .transaction_write(move |conn| {
            crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 11, 7)
        })
        .await
        .expect("record_game_result failed");

    // Game row
    assert_eq!(game.player1_id, p1_id);
    assert_eq!(game.player2_id, p2_id);
    assert_eq!(game.winner_id, p1_id);
    assert_eq!(game.score_p1, 11);
    assert_eq!(game.score_p2, 7);

    // Player 1 (winner)
    assert_eq!(stats1.games_played, 1);
    assert_eq!(stats1.games_won, 1);
    assert_eq!(stats1.current_win_streak, 1);
    assert!(stats1.xp > 0);

    // Player 2 (loser)
    assert_eq!(stats2.games_played, 1);
    assert_eq!(stats2.games_won, 0);
    assert_eq!(stats2.current_win_streak, 0);
}

/// GET /api/games/@me returns the recorded game.
#[tokio::test]
async fn get_my_games_returns_game() {
    let server = mock::Server::default();

    let mut p1 = server.user().register().await;
    let p2 = server.user().register().await;
    let p1_id = p1.user_id();
    let p2_id = p2.user_id();

    server
        .db
        .transaction_write(move |conn| {
            crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 11, 7)
        })
        .await
        .expect("record_game_result failed");

    let req = p1.client.get("/api/games/@me");
    let mut resp = p1.client.send(req).await;

    assert_eq!(resp.status_code, Some(salvo::http::StatusCode::OK));
    let body: Vec<serde_json::Value> = resp.take_json().await.unwrap();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["winner_id"], p1_id);
}

/// POST /api/stats/record-game no longer exists — must return 404.
#[tokio::test]
async fn record_game_http_endpoint_removed() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let req = user
        .client
        .post("/api/stats/record-game")
        .json(&serde_json::json!({ "won": true }));
    let resp = user.client.send(req).await;

    assert_eq!(resp.status_code, Some(salvo::http::StatusCode::NOT_FOUND));
}
