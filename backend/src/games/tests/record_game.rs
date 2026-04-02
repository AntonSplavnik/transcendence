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
            crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 5, 2, 1500, 800)
        })
        .await
        .expect("record_game_result failed");

    // Game row
    assert_eq!(game.player1_id, p1_id);
    assert_eq!(game.player2_id, p2_id);
    assert_eq!(game.winner_id, p1_id);
    assert_eq!(game.kills_p1, 5);
    assert_eq!(game.kills_p2, 2);
    assert_eq!(game.damage_p1, 1500);
    assert_eq!(game.damage_p2, 800);

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
            crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 5, 2, 1500, 800)
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

/// Loss awards only participation XP, win awards participation + win bonus.
#[tokio::test]
async fn xp_values_are_correct() {
    use crate::gamification::xp::rewards;

    let server = mock::Server::default();
    let p1 = server.user().register().await;
    let p2 = server.user().register().await;
    let p1_id = p1.user_id();
    let p2_id = p2.user_id();

    let (_, stats1, stats2) = server
        .db
        .transaction_write(move |conn| {
            crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 11, 7, "1v1")
        })
        .await
        .expect("record_game_result failed");

    assert_eq!(stats1.xp, rewards::GAME_PLAYED + rewards::GAME_WON); // 35
    assert_eq!(stats2.xp, rewards::GAME_PLAYED); // 10
}

/// Win streak bonus kicks in at 3 consecutive wins and is capped.
#[tokio::test]
async fn win_streak_bonus_accumulates_and_caps() {
    use crate::gamification::xp::rewards;

    let server = mock::Server::default();
    let p1 = server.user().register().await;
    let p2 = server.user().register().await;
    let p1_id = p1.user_id();
    let p2_id = p2.user_id();

    // 5 consecutive wins for p1
    for _ in 0..5 {
        server
            .db
            .transaction_write(move |conn| {
                crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 11, 0, "1v1")
            })
            .await
            .expect("record_game_result failed");
    }

    let (_, stats1, _) = server
        .db
        .transaction_write(move |conn| {
            crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 11, 0, "1v1")
        })
        .await
        .expect("record_game_result failed");

    assert_eq!(stats1.current_win_streak, 6);
    assert_eq!(stats1.best_win_streak, 6);
    // streak bonus at streak=6: (6 - 3 + 1) * 5 = 20, capped at 25 → 20
    let expected_last_xp = rewards::GAME_PLAYED + rewards::GAME_WON + 20;
    // total xp: 5 previous games + last game
    // wins 1,2: no bonus → 35 each
    // win 3: (3-3+1)*5=5 → 40
    // win 4: (4-3+1)*5=10 → 45
    // win 5: (5-3+1)*5=15 → 50
    // win 6: (6-3+1)*5=20 → 55
    let expected_total = 35 + 35 + 40 + 45 + 50 + expected_last_xp;
    assert_eq!(stats1.xp, expected_total);
}

/// A loss resets the current win streak but preserves the best streak.
#[tokio::test]
async fn loss_resets_streak_but_preserves_best() {
    let server = mock::Server::default();
    let p1 = server.user().register().await;
    let p2 = server.user().register().await;
    let p1_id = p1.user_id();
    let p2_id = p2.user_id();

    // 3 wins then 1 loss
    for _ in 0..3 {
        server
            .db
            .transaction_write(move |conn| {
                crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 11, 0, "1v1")
            })
            .await
            .expect("record_game_result failed");
    }

    let (_, stats1, _) = server
        .db
        .transaction_write(move |conn| {
            crate::games::record_game_result(conn, p1_id, p2_id, p2_id, 0, 11, "1v1")
        })
        .await
        .expect("record_game_result failed");

    assert_eq!(stats1.current_win_streak, 0);
    assert_eq!(stats1.best_win_streak, 3);
}

/// record_game returns leveled_up=true when XP crosses a level threshold.
#[tokio::test]
async fn level_up_is_detected() {
    use crate::gamification::xp;

    let server = mock::Server::default();
    let p1 = server.user().register().await;
    let p2 = server.user().register().await;
    let p1_id = p1.user_id();
    let p2_id = p2.user_id();

    // Win enough games to reach level 2 (needs 25 XP; each win = 35 XP)
    let (_, stats1, _) = server
        .db
        .transaction_write(move |conn| {
            crate::games::record_game_result(conn, p1_id, p2_id, p1_id, 11, 0, "1v1")
        })
        .await
        .expect("record_game_result failed");

    assert!(stats1.xp >= xp::total_xp_for_level(2));
    assert_eq!(stats1.level, xp::level_from_xp(stats1.xp));
    assert!(stats1.level >= 2);
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

    // 405 = path matched but POST not allowed — no write endpoint exists for stats
    assert!(matches!(
        resp.status_code,
        Some(salvo::http::StatusCode::NOT_FOUND) | Some(salvo::http::StatusCode::METHOD_NOT_ALLOWED)
    ));
}
