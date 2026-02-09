pub use diesel::prelude::*;
pub use salvo::oapi::{ToSchema, endpoint, extract::JsonBody};
pub use salvo::prelude::*;
pub use serde::{Deserialize, Serialize};
pub use validator::Validate;

pub use crate::auth::{DepotAuthExt as _, RouterAuthExt as _};
pub use crate::db::{self, DbConn};
pub use crate::error::ApiError;
pub use crate::utils::NICK_CACHE;
pub use crate::utils::limiter::{RateLimit, RouterRateLimitExt as _};
pub use crate::utils::nick_cache::NicknameCache as _;

pub type AppResult<T> = Result<T, ApiError>;
pub type JsonResult<T> = Result<Json<T>, ApiError>;

pub fn json_ok<T>(data: T) -> JsonResult<T> {
    Ok(Json(data))
}
