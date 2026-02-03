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
                Router::with_path("id")
                    .user_rate_limit(&RateLimit::per_5_minutes(200))
                    .post(get_users_by_id),
                Router::with_path("nickname")
                    .user_rate_limit(&RateLimit::per_5_minutes(50))
                    .post(get_users_by_nickname),
            ]))
        .push(
            Router::with_path("nickname-exists")
                .ip_rate_limit(&RateLimit::per_15_minutes(60))
                .post(check_nickname),
        )
}

#[derive(Debug, Serialize, ToSchema)]
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
fn check_nickname(json: JsonBody<Nickname>) -> JsonResult<CheckNicknameOutput> {
    use crate::schema::users::dsl::*;
    let conn = &mut db::get();
    let input = json.into_inner();

    let exists =
        diesel::select(diesel::dsl::exists(users.filter(nickname.eq(&input))))
            .get_result(conn)?;

    let valid = crate::validate::nickname(&input).is_ok();

    json_ok(CheckNicknameOutput { exists, valid })
}

/// Retrieve users by their IDs
#[endpoint]
fn get_users_by_id(json: JsonBody<Vec<i32>>) -> JsonResult<Vec<PublicUser>> {
    use crate::schema::users::dsl::*;
    let conn = &mut db::get();
    let user_ids = json.into_inner();

    let result = users.filter(id.eq_any(user_ids)).load::<User>(conn)?;

    json_ok(result.into_iter().map(PublicUser::from).collect())
}

/// Retrieve users by their nicknames
#[endpoint]
fn get_users_by_nickname(
    json: JsonBody<Vec<Nickname>>,
) -> JsonResult<Vec<PublicUser>> {
    use crate::schema::users::dsl::*;
    let conn = &mut db::get();
    let nicknames = json.into_inner();

    let result = users
        .filter(nickname.eq_any(nicknames))
        .load::<User>(conn)?;

    json_ok(result.into_iter().map(PublicUser::from).collect())
}
