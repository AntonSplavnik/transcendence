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

#[derive(Debug, Clone, Copy)]
pub struct HeadToHeadResult {
    pub player1_id: i32,
    pub player2_id: i32,
    pub winner_id: i32,
    pub kills_p1: i32,
    pub kills_p2: i32,
    pub damage_p1: i32,
    pub damage_p2: i32,
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
#[cfg_attr(not(test), allow(dead_code))]
#[allow(clippy::cast_precision_loss)]
pub fn record_game_result(
    conn: &mut DbConn,
    result: HeadToHeadResult,
) -> QueryResult<(Game, UserStats, UserStats)> {
    use crate::schema::games::dsl as games_dsl;

    // 1. Insert game record
    let game = diesel::insert_into(games_dsl::games)
        .values(&NewGame::new(
            result.player1_id,
            result.player2_id,
            result.winner_id,
            result.kills_p1,
            result.kills_p2,
            result.damage_p1,
            result.damage_p2,
        ))
        .returning(Game::as_returning())
        .get_result(conn)?;

    // 2. Reuse match-end stats logic for both players.
    let mut updated_stats = record_match_end_stats(
        conn,
        vec![
            MatchPlayerResult {
                player_id: result.player1_id,
                placement: if result.winner_id == result.player1_id {
                    1
                } else {
                    2
                },
                kills: result.kills_p1,
                deaths: result.kills_p2,
                damage_dealt: result.damage_p1 as f32,
                damage_taken: result.damage_p2 as f32,
            },
            MatchPlayerResult {
                player_id: result.player2_id,
                placement: if result.winner_id == result.player2_id {
                    1
                } else {
                    2
                },
                kills: result.kills_p2,
                deaths: result.kills_p1,
                damage_dealt: result.damage_p2 as f32,
                damage_taken: result.damage_p1 as f32,
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
