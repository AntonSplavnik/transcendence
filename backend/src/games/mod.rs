pub mod router;

use crate::{
    models::{Game, NewGame, UserStats},
    prelude::*,
};

/// Called by server-side game logic at the end of a match.
/// Never exposed as an HTTP endpoint.
/// Inserts the game record and updates both players' stats atomically.
pub fn record_game_result(
    conn: &mut DbConn,
    player1_id: i32,
    player2_id: i32,
    winner_id: i32,
    score_p1: i32,
    score_p2: i32,
    mode: &str,
) -> QueryResult<(Game, UserStats, UserStats)> {
    use crate::schema::{games::dsl as games_dsl, user_stats::dsl as stats_dsl};

    // 1. Insert game record
    let game = diesel::insert_into(games_dsl::games)
        .values(&NewGame::new(player1_id, player2_id, winner_id, score_p1, score_p2, mode.to_string()))
        .returning(Game::as_returning())
        .get_result(conn)?;

    // 2. Get-or-create stats for both players
    let mut stats1 = stats_dsl::user_stats
        .filter(stats_dsl::user_id.eq(player1_id))
        .first::<UserStats>(conn)
        .optional()?
        .unwrap_or_else(|| UserStats::new(player1_id));

    let mut stats2 = stats_dsl::user_stats
        .filter(stats_dsl::user_id.eq(player2_id))
        .first::<UserStats>(conn)
        .optional()?
        .unwrap_or_else(|| UserStats::new(player2_id));

    // 3. Apply game results
    stats1.record_game(winner_id == player1_id);
    stats2.record_game(winner_id == player2_id);

    // 4. Upsert both stats rows
    diesel::replace_into(stats_dsl::user_stats)
        .values(&stats1)
        .execute(conn)?;
    diesel::replace_into(stats_dsl::user_stats)
        .values(&stats2)
        .execute(conn)?;

    Ok((game, stats1, stats2))
}

#[cfg(test)]
mod tests;
