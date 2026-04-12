pub mod router;

use crate::{models::UserStats, prelude::*};

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
#[cfg(test)]
mod tests;
