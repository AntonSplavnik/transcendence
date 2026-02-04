use diesel::prelude::*;
use rand::prelude::IndexedRandom;

use crate::db::DbConn;
use crate::gamification::xp;
use crate::models::{ActiveDailyChallenge, DailyChallengePool, UserDailyProgress, UserStats};

/// Returns today's date as "YYYY-MM-DD" in UTC.
fn today_str() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

/// Ensure 3 daily challenges exist for today (1 easy, 1 medium, 1 hard).
/// Uses lazy selection: if entries already exist for today, does nothing.
pub fn ensure_daily_challenges(conn: &mut DbConn) -> Result<(), diesel::result::Error> {
    use crate::schema::active_daily_challenges::dsl as adc;
    use crate::schema::daily_challenge_pool::dsl as pool;

    let today = today_str();

    // Check if today's challenges already exist
    let count: i64 = adc::active_daily_challenges
        .filter(adc::active_date.eq(&today))
        .count()
        .get_result(conn)?;

    if count >= 3 {
        return Ok(());
    }

    // Pick one from each difficulty
    let difficulties = [("easy", 1), ("medium", 2), ("hard", 3)];

    for (difficulty, slot) in difficulties {
        // Check if this slot is already filled
        let slot_exists: bool = diesel::select(diesel::dsl::exists(
            adc::active_daily_challenges
                .filter(adc::active_date.eq(&today))
                .filter(adc::slot.eq(slot)),
        ))
        .get_result(conn)?;

        if slot_exists {
            continue;
        }

        let candidates: Vec<DailyChallengePool> = pool::daily_challenge_pool
            .filter(pool::difficulty.eq(difficulty))
            .load(conn)?;

        if let Some(chosen) = candidates.choose(&mut rand::rng()) {
            diesel::insert_into(adc::active_daily_challenges)
                .values((
                    adc::challenge_id.eq(chosen.id),
                    adc::active_date.eq(&today),
                    adc::slot.eq(slot),
                ))
                .execute(conn)?;
        }
    }

    Ok(())
}

/// Get today's active challenges with their pool definitions.
/// Returns (ActiveDailyChallenge, DailyChallengePool) pairs.
pub fn get_todays_challenges(
    conn: &mut DbConn,
) -> Result<Vec<(ActiveDailyChallenge, DailyChallengePool)>, diesel::result::Error> {
    use crate::schema::active_daily_challenges::dsl as adc;
    use crate::schema::daily_challenge_pool::dsl as pool;

    let today = today_str();

    adc::active_daily_challenges
        .inner_join(pool::daily_challenge_pool.on(pool::id.eq(adc::challenge_id)))
        .filter(adc::active_date.eq(&today))
        .order(adc::slot.asc())
        .select((ActiveDailyChallenge::as_select(), DailyChallengePool::as_select()))
        .load::<(ActiveDailyChallenge, DailyChallengePool)>(conn)
}

/// Update daily progress for a user after a game is recorded.
/// Increments progress for each active challenge whose stat_to_track matches.
pub fn update_daily_progress(
    conn: &mut DbConn,
    user_id: i32,
    won: bool,
    stats: &UserStats,
) -> Result<(), diesel::result::Error> {
    use crate::schema::user_daily_progress::dsl as udp;

    // Ensure today's challenges exist
    ensure_daily_challenges(conn)?;

    let challenges = get_todays_challenges(conn)?;

    for (active, pool_entry) in &challenges {
        // Get or create progress row
        let existing: Option<UserDailyProgress> = udp::user_daily_progress
            .filter(udp::user_id.eq(user_id))
            .filter(udp::active_challenge_id.eq(active.id))
            .first::<UserDailyProgress>(conn)
            .optional()?;

        // If already completed, skip
        if existing.as_ref().is_some_and(|p| p.completed_at.is_some()) {
            continue;
        }

        // Calculate the increment based on stat_to_track
        let increment = match pool_entry.stat_to_track.as_str() {
            "games_played" => 1, // always +1 per game
            "games_won" => {
                if won { 1 } else { 0 }
            }
            "win_streak" => {
                // For win_streak, use the absolute value (current_win_streak after update)
                // We set progress to the current streak directly rather than incrementing
                if won { stats.current_win_streak } else { 0 }
            }
            _ => 0,
        };

        if increment == 0 && pool_entry.stat_to_track != "win_streak" {
            continue;
        }

        let new_progress = if pool_entry.stat_to_track == "win_streak" {
            // For streak: set to current value (reset on loss)
            increment
        } else {
            existing.as_ref().map_or(0, |p| p.current_progress) + increment
        };

        let completed = new_progress >= pool_entry.target_value;
        let completed_at = if completed {
            Some(chrono::Utc::now().naive_utc())
        } else {
            None
        };

        if existing.is_some() {
            diesel::update(
                udp::user_daily_progress
                    .filter(udp::user_id.eq(user_id))
                    .filter(udp::active_challenge_id.eq(active.id)),
            )
            .set((
                udp::current_progress.eq(new_progress),
                udp::completed_at.eq(completed_at),
            ))
            .execute(conn)?;
        } else {
            diesel::insert_into(udp::user_daily_progress)
                .values((
                    udp::user_id.eq(user_id),
                    udp::active_challenge_id.eq(active.id),
                    udp::current_progress.eq(new_progress),
                    udp::completed_at.eq(completed_at),
                    udp::xp_claimed.eq(false),
                ))
                .execute(conn)?;
        }
    }

    Ok(())
}

/// Claim XP for a completed daily challenge.
/// Returns the XP awarded (0 if already claimed or not complete).
pub fn claim_challenge(
    conn: &mut DbConn,
    user_id: i32,
    active_challenge_id: i32,
) -> Result<ClaimResult, diesel::result::Error> {
    use crate::schema::active_daily_challenges::dsl as adc;
    use crate::schema::daily_challenge_pool::dsl as pool;
    use crate::schema::user_daily_progress::dsl as udp;
    use crate::schema::user_stats::dsl as us;

    let today = today_str();

    // Verify the active challenge exists and is for today
    let active: ActiveDailyChallenge = adc::active_daily_challenges
        .filter(adc::id.eq(active_challenge_id))
        .filter(adc::active_date.eq(&today))
        .first(conn)?;

    // Get the pool entry for XP reward
    let pool_entry: DailyChallengePool = pool::daily_challenge_pool
        .filter(pool::id.eq(active.challenge_id))
        .first(conn)?;

    // Get user's progress
    let progress: UserDailyProgress = udp::user_daily_progress
        .filter(udp::user_id.eq(user_id))
        .filter(udp::active_challenge_id.eq(active_challenge_id))
        .first(conn)?;

    // Check: must be completed and not yet claimed
    if progress.completed_at.is_none() {
        return Ok(ClaimResult::NotCompleted);
    }
    if progress.xp_claimed {
        return Ok(ClaimResult::AlreadyClaimed);
    }

    // Mark as claimed
    diesel::update(
        udp::user_daily_progress
            .filter(udp::user_id.eq(user_id))
            .filter(udp::active_challenge_id.eq(active_challenge_id)),
    )
    .set(udp::xp_claimed.eq(true))
    .execute(conn)?;

    // Award XP to user_stats
    let xp_reward = pool_entry.xp_reward;

    let mut stats: UserStats = us::user_stats
        .filter(us::user_id.eq(user_id))
        .first(conn)?;

    stats.xp += xp_reward;
    stats.level = xp::level_from_xp(stats.xp);

    diesel::update(us::user_stats.filter(us::user_id.eq(user_id)))
        .set((
            us::xp.eq(stats.xp),
            us::level.eq(stats.level),
            us::updated_at.eq(chrono::Utc::now().naive_utc()),
        ))
        .execute(conn)?;

    Ok(ClaimResult::Claimed {
        xp_reward,
        new_xp: stats.xp,
        new_level: stats.level,
    })
}

pub enum ClaimResult {
    Claimed {
        xp_reward: i32,
        new_xp: i32,
        new_level: i32,
    },
    NotCompleted,
    AlreadyClaimed,
}
