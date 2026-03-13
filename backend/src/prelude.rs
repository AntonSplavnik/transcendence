#![allow(unused_imports)]

pub use diesel::prelude::*;
pub use salvo::oapi::{endpoint, extract::JsonBody, extract::PathParam, ToSchema};
pub use salvo::prelude::*;
pub use serde::{Deserialize, Serialize};
pub use validator::Validate;

pub use crate::auth::{DepotAuthExt as _, RouterAuthExt as _};
pub use crate::db::{self, Database, Db, DbConn, DbError, DepotDatabaseExt as _};
pub use crate::error::ApiError;
pub use crate::game::GameManagerDepotExt as _;
pub use crate::notifications::NotificationManagerDepotExt as _;
pub use crate::stream::StreamManagerDepotExt as _;
pub use crate::utils::limiter::{RateLimit, RouterRateLimitExt as _};
pub use crate::utils::nick_cache::NicknameCache;
pub use crate::utils::nick_cache::NicknameCacheDepotExt as _;

pub type AppResult<T> = Result<T, ApiError>;
pub type JsonResult<T> = Result<Json<T>, ApiError>;

pub fn json_ok<T>(data: T) -> JsonResult<T> {
    Ok(Json(data))
}
