//! Read-only game history endpoints.
//! Writing to `games` is only done via `games::record_game_result`.

use chrono::{DateTime, Utc};

use crate::{models::Game, prelude::*};

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("games")
        .push(
            Router::with_path("@me")
                .requires_user_login()
                .user_rate_limit(&RateLimit::per_5_minutes(100))
                .get(get_my_games),
        )
        .push(
            Router::with_path("{user_id}")
                .requires_user_login()
                .user_rate_limit(&RateLimit::per_5_minutes(200))
                .get(get_user_games),
        )
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GameResponse {
    pub id: i32,
    pub player1_id: i32,
    pub player2_id: i32,
    pub winner_id: i32,
    pub score_p1: i32,
    pub score_p2: i32,
    pub played_at: DateTime<Utc>,
    pub mode: String,
}

impl From<Game> for GameResponse {
    fn from(g: Game) -> Self {
        Self {
            id: g.id,
            player1_id: g.player1_id,
            player2_id: g.player2_id,
            winner_id: g.winner_id,
            score_p1: g.score_p1,
            score_p2: g.score_p2,
            played_at: g.played_at,
            mode: g.mode,
        }
    }
}

/// Get the last 20 games for the current user
#[endpoint]
async fn get_my_games(depot: &mut Depot, db: Db) -> JsonResult<Vec<GameResponse>> {
    let user_id = depot.user_id();
    get_recent_games(user_id, db).await
}

/// Get the last 20 games for a given user (public)
#[endpoint]
async fn get_user_games(req: &mut Request, db: Db) -> JsonResult<Vec<GameResponse>> {
    let user_id: i32 = req.param("user_id").unwrap_or(0);
    if user_id == 0 {
        return Err(diesel::result::Error::NotFound.into());
    }

    // Verify the user exists
    db.transaction_readonly(move |conn| {
        use crate::schema::users;
        users::table
            .filter(users::id.eq(user_id))
            .select(users::id)
            .first::<i32>(conn)
            .map(|_| ())
    })
    .await?;

    get_recent_games(user_id, db).await
}

async fn get_recent_games(user_id: i32, db: Db) -> JsonResult<Vec<GameResponse>> {
    let games = db
        .transaction_readonly(move |conn| {
            use crate::schema::games::dsl;
            dsl::games
                .filter(
                    dsl::player1_id
                        .eq(user_id)
                        .or(dsl::player2_id.eq(user_id)),
                )
                .order(dsl::played_at.desc())
                .limit(20)
                .load::<Game>(conn)
        })
        .await?;

    json_ok(games.into_iter().map(GameResponse::from).collect())
}
