//! Provides gamification routes: stats, XP, levels, achievements

use crate::models::{Achievement, UserAchievement, UserStats};
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use super::achievements::{self, AchievementTier, AchievementUnlock};
use super::xp;

pub fn router(path: &str) -> Router {
    Router::with_path(path)
	.requires_user_login()
        .oapi_tag("stats")
        .push(
            Router::with_path("@me")
                .user_rate_limit(&RateLimit::per_5_minutes(100))
                .get(get_my_stats),
        )
        .push(
            Router::with_path("achievements")
                .oapi_tag("achievements")
                .push(
                    Router::new()
                        .user_rate_limit(&RateLimit::per_5_minutes(100))
                        .get(get_achievements),
                )
                .push(
                    Router::with_path("recent")
                        .user_rate_limit(&RateLimit::per_5_minutes(100))
                        .get(get_recent_achievements),
                ),
        )
        .push(
            Router::with_path("{user_id}")
                .user_rate_limit(&RateLimit::per_5_minutes(200))
                .get(get_user_stats),
        )
}

// ============================================================================
// Stats response types
// ============================================================================

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
    pub kills: i32,
    pub deaths: i32,
    pub damage_dealt: f32,
    pub damage_taken: f32,
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
            kills: stats.kills,
            deaths: stats.deaths,
            damage_dealt: stats.damage_dealt,
            damage_taken: stats.damage_taken,
            win_rate: stats.win_rate(),
            current_win_streak: stats.current_win_streak,
            best_win_streak: stats.best_win_streak,
        }
    }
}

// ============================================================================
// record-game
// ============================================================================

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

// ============================================================================
// Stats endpoints
// ============================================================================

/// Get current user's stats
#[endpoint]
async fn get_my_stats(depot: &mut Depot, db: Db) -> JsonResult<StatsResponse> {
    let user_id = depot.user_id();
    get_stats(user_id, db).await
}

/// Get a user's stats by ID
#[endpoint(parameters(("user_id" = i32, Path, description = "User ID")))]
async fn get_user_stats(req: &mut Request, db: Db) -> JsonResult<StatsResponse> {
    let user_id: i32 = req.param("user_id").unwrap_or(0);
    if user_id == 0 {
        return Err(diesel::result::Error::NotFound.into());
    }
    get_stats(user_id, db).await
}

async fn get_stats(user_id: i32, db: Db) -> JsonResult<StatsResponse> {
    let stats = db
        .transaction_readonly(move |conn| {
            use crate::schema::user_stats::dsl;

            // Verify user exists (will return NotFound error if not)
            use crate::schema::users;
            users::table
                .filter(users::id.eq(user_id))
                .select(users::id)
                .first::<i32>(conn)?;

            let stats = dsl::user_stats
                .filter(dsl::user_id.eq(user_id))
                .first::<UserStats>(conn)
                .optional()?;

            Ok(stats.unwrap_or_else(|| UserStats::new(user_id)))
        })
        .await?;

    json_ok(StatsResponse::from(stats))
}

// ============================================================================
// Achievement endpoints
// ============================================================================

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

#[derive(Debug, Serialize, ToSchema)]
struct AchievementWithProgress {
    #[serde(flatten)]
    achievement: AchievementResponse,
    current_progress: i32,
    bronze_unlocked: bool,
    silver_unlocked: bool,
    gold_unlocked: bool,
}

/// Get all achievements with current user's progress
#[endpoint]
async fn get_achievements(depot: &mut Depot, db: Db) -> JsonResult<Vec<AchievementWithProgress>> {
    use crate::schema::achievements::dsl as ach_dsl;
    use crate::schema::user_achievements::dsl as ua_dsl;

    let user_id = depot.user_id();

    let (all_achievements, user_progress) = db
        .transaction_readonly(move |conn| {
            let all = ach_dsl::achievements
                .order(ach_dsl::id.asc())
                .load::<Achievement>(conn)?;
            let progress = ua_dsl::user_achievements
                .filter(ua_dsl::user_id.eq(user_id))
                .load::<UserAchievement>(conn)?;
            Ok((all, progress))
        })
        .await?;

    let result = all_achievements
        .into_iter()
        .map(|ach| {
            let progress = user_progress.iter().find(|ua| ua.achievement_id == ach.id);
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

/// Get recently unlocked achievement tiers for the current user (last 20)
#[endpoint]
async fn get_recent_achievements(depot: &mut Depot, db: Db) -> JsonResult<Vec<RecentUnlock>> {
    use crate::schema::achievements::dsl as ach_dsl;
    use crate::schema::user_achievements::dsl as ua_dsl;

    let user_id = depot.user_id();

    let (user_progress, achievements_map) = db
        .transaction_readonly(move |conn| {
            let progress = ua_dsl::user_achievements
                .filter(ua_dsl::user_id.eq(user_id))
                .load::<UserAchievement>(conn)?;
            let ids: Vec<i32> = progress.iter().map(|ua| ua.achievement_id).collect();
            let map = ach_dsl::achievements
                .filter(ach_dsl::id.eq_any(&ids))
                .load::<Achievement>(conn)?;
            Ok((progress, map))
        })
        .await?;

    let mut recent: Vec<RecentUnlock> = Vec::new();

    for ua in &user_progress {
        let Some(ach) = achievements_map.iter().find(|a| a.id == ua.achievement_id) else {
            continue;
        };

        for (ts, tier) in [
            (ua.gold_unlocked_at, AchievementTier::Gold),
            (ua.silver_unlocked_at, AchievementTier::Silver),
            (ua.bronze_unlocked_at, AchievementTier::Bronze),
        ] {
            if let Some(at) = ts {
                recent.push(RecentUnlock {
                    achievement_name: ach.name.clone(),
                    achievement_code: ach.code.clone(),
                    tier,
                    unlocked_at: at.to_rfc3339(),
                });
            }
        }
    }

    recent.sort_by(|a, b| b.unlocked_at.cmp(&a.unlocked_at));
    recent.truncate(20);

    json_ok(recent)
}
