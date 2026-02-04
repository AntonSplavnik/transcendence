//! Provides gamification routes: stats, XP, levels, achievements

use crate::models::{Achievement, UserAchievement, UserStats};
use crate::prelude::*;

use super::achievements::{self, AchievementTier, AchievementUnlock};
use super::daily_challenges;
use super::xp;

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("stats")
        .push(
            Router::with_path("@me")
                .requires_user_login()
                .user_rate_limit(&RateLimit::per_5_minutes(100))
                .get(get_my_stats),
        )
        .push(
            Router::with_path("record-game")
                .requires_user_login()
                .user_rate_limit(&RateLimit::per_5_minutes(60))
                .post(record_game),
        )
        .push(
            Router::with_path("achievements")
                .oapi_tag("achievements")
                .push(
                    Router::new()
                        .requires_user_login()
                        .user_rate_limit(&RateLimit::per_5_minutes(100))
                        .get(get_achievements),
                )
                .push(
                    Router::with_path("recent")
                        .requires_user_login()
                        .user_rate_limit(&RateLimit::per_5_minutes(100))
                        .get(get_recent_achievements),
                ),
        )
        .push(
            Router::with_path("challenges")
                .oapi_tag("daily-challenges")
                .push(
                    Router::with_path("daily")
                        .requires_user_login()
                        .user_rate_limit(&RateLimit::per_5_minutes(100))
                        .get(get_daily_challenges),
                )
                .push(
                    Router::with_path("claim/<challenge_id>")
                        .requires_user_login()
                        .user_rate_limit(&RateLimit::per_5_minutes(30))
                        .post(claim_daily_challenge),
                ),
        )
        .push(
            Router::with_path("<user_id>")
                .requires_user_login()
                .user_rate_limit(&RateLimit::per_5_minutes(200))
                .get(get_user_stats),
        )
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StatsResponse {
    pub user_id: i32,
    pub xp: i32,
    pub level: i32,
    pub xp_in_level: i32,
    pub xp_to_next: i32,
    pub progress_percent: f32,
    pub games_played: i32,
    pub games_won: i32,
    pub games_lost: i32,
    pub win_rate: f32,
    pub current_win_streak: i32,
    pub best_win_streak: i32,
}

impl From<UserStats> for StatsResponse {
    fn from(stats: UserStats) -> Self {
        Self {
            user_id: stats.user_id,
            xp: stats.xp,
            level: stats.level,
            xp_in_level: xp::xp_in_current_level(stats.xp),
            xp_to_next: xp::xp_for_next_level(stats.level),
            progress_percent: xp::level_progress_percent(stats.xp),
            games_played: stats.games_played,
            games_won: stats.games_won,
            games_lost: stats.games_lost(),
            win_rate: stats.win_rate(),
            current_win_streak: stats.current_win_streak,
            best_win_streak: stats.best_win_streak,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
struct RecordGameInput {
    won: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecordGameResponse {
    pub xp_gained: i32,
    pub leveled_up: bool,
    pub stats: StatsResponse,
    pub achievement_unlocks: Vec<AchievementUnlock>,
}

/// Record a game result: updates stats, awards XP, recalculates level, checks achievements
#[endpoint]
async fn record_game(depot: &mut Depot, json: JsonBody<RecordGameInput>) -> JsonResult<RecordGameResponse> {
    use crate::schema::user_stats::dsl;
    let user_id = depot.user_id();
    let input = json.into_inner();
    let conn = &mut db::get()?;

    // Get or create stats
    let mut stats = dsl::user_stats
        .filter(dsl::user_id.eq(user_id))
        .first::<UserStats>(conn)
        .optional()?
        .unwrap_or_else(|| UserStats::new(user_id));

    // Apply game result
    let (mut xp_gained, leveled_up) = stats.record_game(input.won);

    // Upsert stats
    diesel::replace_into(dsl::user_stats)
        .values(&stats)
        .execute(conn)?;

    // Check achievements
    let achievement_unlocks = achievements::check_achievements(conn, user_id, &stats)?;

    // Award achievement XP
    let achievement_xp: i32 = achievement_unlocks.iter().map(|u| u.xp_reward).sum();
    if achievement_xp > 0 {
        xp_gained += achievement_xp;
        stats.xp += achievement_xp;
        let new_level = xp::level_from_xp(stats.xp);
        stats.level = new_level;

        diesel::update(dsl::user_stats.filter(dsl::user_id.eq(user_id)))
            .set((dsl::xp.eq(stats.xp), dsl::level.eq(stats.level)))
            .execute(conn)?;
    }

    // Update daily challenge progress
    daily_challenges::update_daily_progress(conn, user_id, input.won, &stats)?;

    json_ok(RecordGameResponse {
        xp_gained,
        leveled_up,
        stats: StatsResponse::from(stats),
        achievement_unlocks,
    })
}

/// Get current user's stats
#[endpoint]
async fn get_my_stats(depot: &mut Depot) -> JsonResult<StatsResponse> {
    let user_id = depot.user_id();
    get_or_create_stats(user_id)
}

/// Get a user's stats by ID
#[endpoint]
async fn get_user_stats(req: &mut Request) -> JsonResult<StatsResponse> {
    let user_id: i32 = req.param("user_id").unwrap_or(0);
    if user_id == 0 {
        return Err(diesel::result::Error::NotFound.into());
    }
    get_or_create_stats(user_id)
}

fn get_or_create_stats(user_id: i32) -> JsonResult<StatsResponse> {
    use crate::schema::user_stats::dsl;
    let conn = &mut db::get()?;

    // Try to get existing stats
    let stats = dsl::user_stats
        .filter(dsl::user_id.eq(user_id))
        .first::<UserStats>(conn)
        .optional()?;

    let stats = match stats {
        Some(s) => s,
        None => {
            // Verify user exists (will return NotFound error if not)
            use crate::schema::users;
            users::table
                .filter(users::id.eq(user_id))
                .first::<crate::models::User>(conn)?;

            // Create default stats for user
            let new_stats = UserStats::new(user_id);
            diesel::insert_into(dsl::user_stats)
                .values(&new_stats)
                .execute(conn)?;
            new_stats
        }
    };

    json_ok(StatsResponse::from(stats))
}

// ============================================================================
// Achievement Endpoints
// ============================================================================

#[derive(Debug, Serialize, ToSchema)]
struct AchievementWithProgress {
    #[serde(flatten)]
    achievement: AchievementResponse,
    current_progress: i32,
    bronze_unlocked: bool,
    silver_unlocked: bool,
    gold_unlocked: bool,
}

#[derive(Debug, Serialize, ToSchema)]
struct AchievementResponse {
    id: i32,
    code: String,
    name: String,
    description: String,
    category: String,
    bronze_threshold: i32,
    silver_threshold: i32,
    gold_threshold: i32,
    base_xp_reward: i32,
}

impl From<Achievement> for AchievementResponse {
    fn from(a: Achievement) -> Self {
        Self {
            id: a.id,
            code: a.code,
            name: a.name,
            description: a.description,
            category: a.category,
            bronze_threshold: a.bronze_threshold,
            silver_threshold: a.silver_threshold,
            gold_threshold: a.gold_threshold,
            base_xp_reward: a.base_xp_reward,
        }
    }
}

/// Get all achievements with current user's progress
#[endpoint]
async fn get_achievements(depot: &mut Depot) -> JsonResult<Vec<AchievementWithProgress>> {
    use crate::schema::achievements::dsl as ach_dsl;
    use crate::schema::user_achievements::dsl as ua_dsl;

    let user_id = depot.user_id();
    let conn = &mut db::get()?;

    let all_achievements = ach_dsl::achievements
        .order(ach_dsl::id.asc())
        .load::<Achievement>(conn)?;

    let user_progress = ua_dsl::user_achievements
        .filter(ua_dsl::user_id.eq(user_id))
        .load::<UserAchievement>(conn)?;

    let result: Vec<AchievementWithProgress> = all_achievements
        .into_iter()
        .map(|ach| {
            let progress = user_progress
                .iter()
                .find(|ua| ua.achievement_id == ach.id);

            AchievementWithProgress {
                current_progress: progress.map_or(0, |p| p.current_progress),
                bronze_unlocked: progress.is_some_and(|p| p.bronze_unlocked_at.is_some()),
                silver_unlocked: progress.is_some_and(|p| p.silver_unlocked_at.is_some()),
                gold_unlocked: progress.is_some_and(|p| p.gold_unlocked_at.is_some()),
                achievement: AchievementResponse::from(ach),
            }
        })
        .collect();

    json_ok(result)
}

#[derive(Debug, Serialize, ToSchema)]
struct RecentUnlock {
    achievement_name: String,
    achievement_code: String,
    tier: AchievementTier,
    unlocked_at: String,
}

/// Get recently unlocked achievements for the current user
#[endpoint]
async fn get_recent_achievements(depot: &mut Depot) -> JsonResult<Vec<RecentUnlock>> {
    use crate::schema::achievements::dsl as ach_dsl;
    use crate::schema::user_achievements::dsl as ua_dsl;

    let user_id = depot.user_id();
    let conn = &mut db::get()?;

    let user_progress = ua_dsl::user_achievements
        .filter(ua_dsl::user_id.eq(user_id))
        .load::<UserAchievement>(conn)?;

    let achievement_ids: Vec<i32> = user_progress.iter().map(|ua| ua.achievement_id).collect();

    let achievements_map: Vec<Achievement> = ach_dsl::achievements
        .filter(ach_dsl::id.eq_any(&achievement_ids))
        .load::<Achievement>(conn)?;

    let mut recent: Vec<RecentUnlock> = Vec::new();

    for ua in &user_progress {
        let Some(ach) = achievements_map.iter().find(|a| a.id == ua.achievement_id) else {
            continue;
        };

        if let Some(at) = ua.gold_unlocked_at {
            recent.push(RecentUnlock {
                achievement_name: ach.name.clone(),
                achievement_code: ach.code.clone(),
                tier: AchievementTier::Gold,
                unlocked_at: at.and_utc().to_rfc3339(),
            });
        }
        if let Some(at) = ua.silver_unlocked_at {
            recent.push(RecentUnlock {
                achievement_name: ach.name.clone(),
                achievement_code: ach.code.clone(),
                tier: AchievementTier::Silver,
                unlocked_at: at.and_utc().to_rfc3339(),
            });
        }
        if let Some(at) = ua.bronze_unlocked_at {
            recent.push(RecentUnlock {
                achievement_name: ach.name.clone(),
                achievement_code: ach.code.clone(),
                tier: AchievementTier::Bronze,
                unlocked_at: at.and_utc().to_rfc3339(),
            });
        }
    }

    // Sort by most recent first
    recent.sort_by(|a, b| b.unlocked_at.cmp(&a.unlocked_at));

    // Return last 20 unlocks
    recent.truncate(20);

    json_ok(recent)
}

// ============================================================================
// Daily Challenge Endpoints
// ============================================================================

#[derive(Debug, Serialize, ToSchema)]
struct DailyChallengeWithProgress {
    active_challenge_id: i32,
    code: String,
    description: String,
    difficulty: String,
    target_value: i32,
    xp_reward: i32,
    slot: i32,
    current_progress: i32,
    completed: bool,
    xp_claimed: bool,
}

/// Get today's 3 daily challenges with the current user's progress
#[endpoint]
async fn get_daily_challenges(depot: &mut Depot) -> JsonResult<Vec<DailyChallengeWithProgress>> {
    use crate::schema::user_daily_progress::dsl as udp;

    let user_id = depot.user_id();
    let conn = &mut db::get()?;

    // Ensure today's challenges are selected
    daily_challenges::ensure_daily_challenges(conn)?;

    let challenges = daily_challenges::get_todays_challenges(conn)?;

    let active_ids: Vec<i32> = challenges.iter().map(|(a, _)| a.id).collect();
    let user_progress: Vec<crate::models::UserDailyProgress> = udp::user_daily_progress
        .filter(udp::user_id.eq(user_id))
        .filter(udp::active_challenge_id.eq_any(&active_ids))
        .load(conn)?;

    let result: Vec<DailyChallengeWithProgress> = challenges
        .into_iter()
        .map(|(active, pool)| {
            let progress = user_progress
                .iter()
                .find(|p| p.active_challenge_id == active.id);

            DailyChallengeWithProgress {
                active_challenge_id: active.id,
                code: pool.code,
                description: pool.description,
                difficulty: pool.difficulty,
                target_value: pool.target_value,
                xp_reward: pool.xp_reward,
                slot: active.slot,
                current_progress: progress.map_or(0, |p| p.current_progress),
                completed: progress.is_some_and(|p| p.completed_at.is_some()),
                xp_claimed: progress.is_some_and(|p| p.xp_claimed),
            }
        })
        .collect();

    json_ok(result)
}

#[derive(Debug, Serialize, ToSchema)]
struct ClaimResponse {
    success: bool,
    xp_reward: i32,
    new_xp: i32,
    new_level: i32,
    message: String,
}

/// Claim XP for a completed daily challenge
#[endpoint]
async fn claim_daily_challenge(depot: &mut Depot, req: &mut Request) -> JsonResult<ClaimResponse> {
    let user_id = depot.user_id();
    let challenge_id: i32 = req.param("challenge_id").unwrap_or(0);
    if challenge_id == 0 {
        return Err(diesel::result::Error::NotFound.into());
    }

    let conn = &mut db::get()?;

    match daily_challenges::claim_challenge(conn, user_id, challenge_id)? {
        daily_challenges::ClaimResult::Claimed {
            xp_reward,
            new_xp,
            new_level,
        } => json_ok(ClaimResponse {
            success: true,
            xp_reward,
            new_xp,
            new_level,
            message: format!("Claimed {} XP!", xp_reward),
        }),
        daily_challenges::ClaimResult::NotCompleted => json_ok(ClaimResponse {
            success: false,
            xp_reward: 0,
            new_xp: 0,
            new_level: 0,
            message: "Challenge not completed yet".to_string(),
        }),
        daily_challenges::ClaimResult::AlreadyClaimed => json_ok(ClaimResponse {
            success: false,
            xp_reward: 0,
            new_xp: 0,
            new_level: 0,
            message: "XP already claimed for this challenge".to_string(),
        }),
    }
}
