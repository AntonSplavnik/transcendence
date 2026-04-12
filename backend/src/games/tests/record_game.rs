use crate::{db::Database as _, utils::mock};

/// Recording match-end payload updates all players' gamification stats.
#[tokio::test]
async fn record_match_end_updates_all_players_stats() {
    let server = mock::Server::default();

    let p1 = server.user().register().await;
    let p2 = server.user().register().await;
    let p3 = server.user().register().await;

    let p1_id = p1.user_id();
    let p2_id = p2.user_id();
    let p3_id = p3.user_id();

    let updated = server
        .db
        .transaction_write(move |conn| {
            crate::games::record_match_end_stats(
                conn,
                vec![
                    crate::games::MatchPlayerResult {
                        player_id: p1_id,
                        placement: 1,
                        kills: 7,
                        deaths: 1,
                        damage_dealt: 1234.5,
                        damage_taken: 321.0,
                    },
                    crate::games::MatchPlayerResult {
                        player_id: p2_id,
                        placement: 2,
                        kills: 3,
                        deaths: 5,
                        damage_dealt: 900.0,
                        damage_taken: 1200.0,
                    },
                    crate::games::MatchPlayerResult {
                        player_id: p3_id,
                        placement: 3,
                        kills: 1,
                        deaths: 6,
                        damage_dealt: 500.0,
                        damage_taken: 1100.0,
                    },
                ],
            )
        })
        .await
        .expect("record_match_end_stats failed");

    assert_eq!(updated.len(), 3);

    let stats1 = updated
        .iter()
        .find(|s| s.user_id == p1_id)
        .expect("missing player 1 stats");
    assert_eq!(stats1.games_played, 1);
    assert_eq!(stats1.games_won, 1);
    assert_eq!(stats1.current_win_streak, 1);
    assert_eq!(stats1.kills, 7);
    assert_eq!(stats1.deaths, 1);
    assert!((stats1.damage_dealt - 1234.5).abs() < f32::EPSILON);
    assert!((stats1.damage_taken - 321.0).abs() < f32::EPSILON);

    let stats2 = updated
        .iter()
        .find(|s| s.user_id == p2_id)
        .expect("missing player 2 stats");
    assert_eq!(stats2.games_played, 1);
    assert_eq!(stats2.games_won, 0);
    assert_eq!(stats2.current_win_streak, 0);
    assert_eq!(stats2.kills, 3);
    assert_eq!(stats2.deaths, 5);
    assert!((stats2.damage_dealt - 900.0).abs() < f32::EPSILON);
    assert!((stats2.damage_taken - 1200.0).abs() < f32::EPSILON);

    let stats3 = updated
        .iter()
        .find(|s| s.user_id == p3_id)
        .expect("missing player 3 stats");
    assert_eq!(stats3.games_played, 1);
    assert_eq!(stats3.games_won, 0);
    assert_eq!(stats3.current_win_streak, 0);
    assert_eq!(stats3.kills, 1);
    assert_eq!(stats3.deaths, 6);
    assert!((stats3.damage_dealt - 500.0).abs() < f32::EPSILON);
    assert!((stats3.damage_taken - 1100.0).abs() < f32::EPSILON);
}

/// `POST /api/stats/record-game` accepts authenticated game stat updates.
#[tokio::test]
async fn record_game_http_endpoint_available() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let req = user
        .client
        .post("/api/stats/record-game")
        .json(&serde_json::json!({ "won": true }));
    let resp = user.client.send(req).await;

    assert_eq!(resp.status_code, Some(salvo::http::StatusCode::OK));
}
