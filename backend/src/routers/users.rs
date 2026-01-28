//! Provides user-related routes and handlers.
//!
//! With this you can query users by ID or nickname.
//!

use crate::models::nickname::Nickname;
use crate::prelude::*;
use crate::{models::User, stream::StreamManager};

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("users")
        .push(Router::new().requires_user_login().append(&mut vec![
                Router::with_path("by-id")
                    .user_rate_limit(&RateLimit::per_5_minutes(200))
                    .post(get_users_by_id),
                Router::with_path("by-nickname")
                    .user_rate_limit(&RateLimit::per_5_minutes(50))
                    .post(get_users_by_nickname),
                Router::with_path("nickname")
                    .user_rate_limit(&RateLimit::per_5_minutes(500))
                    .post(get_nicknames_by_ids),
            ]))
        .push(
            Router::with_path("nickname-exists")
                .ip_rate_limit(&RateLimit::per_15_minutes(60))
                .post(check_nickname),
        )
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PublicUser {
    pub id: i32,
    pub nickname: Nickname,
    pub created_at: chrono::NaiveDateTime,
    pub online: bool,
}

impl From<User> for PublicUser {
    fn from(user: User) -> Self {
        let created_at = user.created_at().naive_utc();
        Self {
            id: user.id,
            nickname: user.nickname,
            created_at,
            online: StreamManager::global().is_connected(user.id),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
struct CheckNicknameOutput {
    exists: bool,
    valid: bool,
}

/// Check if a nickname is valid and doesn't exist yet
///
/// Does not require authentication
#[endpoint]
async fn check_nickname(json: JsonBody<Nickname>, db: Db) -> JsonResult<CheckNicknameOutput> {
    use crate::schema::users::dsl::*;
    let input = json.into_inner();
    let valid = crate::validate::nickname(&input).is_ok();
    let input_clone = input.clone();

    let exists = db
        .read(move |conn| {
            diesel::select(diesel::dsl::exists(users.filter(nickname.eq(&input_clone))))
                .get_result(conn)
        })
        .await??;

    json_ok(CheckNicknameOutput { exists, valid })
}

/// Retrieve users by their IDs
#[endpoint]
async fn get_users_by_id(json: JsonBody<Vec<i32>>, db: Db) -> JsonResult<Vec<PublicUser>> {
    use crate::schema::users::dsl::*;
    let user_ids = json.into_inner();

    let result = db
        .read(move |conn| users.filter(id.eq_any(user_ids)).load::<User>(conn))
        .await??;

    json_ok(result.into_iter().map(PublicUser::from).collect())
}

/// Retrieve users by their nicknames
#[endpoint]
async fn get_users_by_nickname(
    json: JsonBody<Vec<Nickname>>,
    db: Db,
) -> JsonResult<Vec<PublicUser>> {
    use crate::schema::users::dsl::*;
    let nicknames = json.into_inner();

    let result = db
        .read(move |conn| users.filter(nickname.eq_any(nicknames)).load::<User>(conn))
        .await??;

    json_ok(result.into_iter().map(PublicUser::from).collect())
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
struct UserNickname {
    id: i32,
    nickname: Nickname,
}

impl From<(i32, Nickname)> for UserNickname {
    fn from(value: (i32, Nickname)) -> Self {
        Self {
            id: value.0,
            nickname: value.1,
        }
    }
}

/// High-performance endpoint for retrieving only the Nickname of a user
#[endpoint]
async fn get_nicknames_by_ids(json: JsonBody<Vec<i32>>, db: Db) -> JsonResult<Vec<UserNickname>> {
    let user_ids = json.into_inner();
    let result = db
        .read(move |conn| NICK_CACHE.try_get_many(user_ids, conn))
        .await??;

    json_ok(result.into_iter().map(UserNickname::from).collect())
}
