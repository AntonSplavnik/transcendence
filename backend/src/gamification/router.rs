//! Provides gamification routes: stats, XP, levels

use crate::models::UserStats;
use crate::prelude::*;

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
}

/// Record a game result: updates stats, awards XP, recalculates level
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
    let (xp_gained, leveled_up) = stats.record_game(input.won);

    // Upsert stats
    diesel::replace_into(dsl::user_stats)
        .values(&stats)
        .execute(conn)?;

    json_ok(RecordGameResponse {
        xp_gained,
        leveled_up,
        stats: StatsResponse::from(stats),
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
