pub mod router;

use crate::{
    models::{Game, NewGame, UserStats},
    prelude::*,
};

#[derive(Debug, Clone)]
pub struct MatchPlayerResult {
    pub player_id: i32,
    pub placement: i32,
    pub kills: i32,
    pub deaths: i32,
    pub damage_dealt: f32,
    pub damage_taken: f32,
}

/// Update `user_stats` for all players from a match-end payload.
///
/// A player is considered winner if `placement == 1`.
/// Returns updated stats for each processed player.
pub fn record_match_end_stats(
    conn: &mut DbConn,
    players: Vec<MatchPlayerResult>,
) -> QueryResult<Vec<UserStats>> {
    use crate::schema::user_stats::dsl as stats_dsl;

    let mut updated = Vec::with_capacity(players.len());

    for player in players {
        let mut stats = stats_dsl::user_stats
            .filter(stats_dsl::user_id.eq(player.player_id))
            .first::<UserStats>(conn)
            .optional()?
            .unwrap_or_else(|| UserStats::new(player.player_id));

        stats.record_game(
            player.placement == 1,
            player.kills,
            player.deaths,
            player.damage_dealt,
            player.damage_taken,
        );

        diesel::replace_into(stats_dsl::user_stats)
            .values(&stats)
            .execute(conn)?;

        updated.push(stats);
    }

    Ok(updated)
}

/// Called by server-side game logic at the end of a match.
/// Never exposed as an HTTP endpoint.
/// Inserts the game record and updates both players' stats atomically.
pub fn record_game_result(
    conn: &mut DbConn,
    player1_id: i32,
    player2_id: i32,
    winner_id: i32,
    kills_p1: i32,
    kills_p2: i32,
    damage_p1: i32,
    damage_p2: i32,
    mode: &str,
) -> QueryResult<(Game, UserStats, UserStats)> {
    use crate::schema::games::dsl as games_dsl;

    // 1. Insert game record
    let game = diesel::insert_into(games_dsl::games)
        .values(&NewGame::new(
            player1_id,
            player2_id,
            winner_id,
            kills_p1,
            kills_p2,
            damage_p1,
            damage_p2,
            mode.to_string(),
        ))
        .returning(Game::as_returning())
        .get_result(conn)?;

    // 2. Reuse match-end stats logic for both players.
    let mut updated_stats = record_match_end_stats(
        conn,
        vec![
            MatchPlayerResult {
                player_id: player1_id,
                placement: if winner_id == player1_id { 1 } else { 2 },
                kills: kills_p1,
                deaths: kills_p2,
                damage_dealt: damage_p1 as f32,
                damage_taken: damage_p2 as f32,
            },
            MatchPlayerResult {
                player_id: player2_id,
                placement: if winner_id == player2_id { 1 } else { 2 },
                kills: kills_p2,
                deaths: kills_p1,
                damage_dealt: damage_p2 as f32,
                damage_taken: damage_p1 as f32,
            },
        ],
    )?;

    let stats2 = updated_stats
        .pop()
        .expect("record_match_end_stats must return one stats row per input player");
    let stats1 = updated_stats
        .pop()
        .expect("record_match_end_stats must return one stats row per input player");

    Ok((game, stats1, stats2))
}

#[cfg(test)]
mod tests;
