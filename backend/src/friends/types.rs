//! Types and helpers for the friends module.

use crate::error::FriendError;
use crate::models::User;
use crate::prelude::*;
use crate::routers::users::PublicUser;

/// Friend request status values stored in the database.
pub struct RequestStatus;

impl RequestStatus {
    pub const PENDING: &'static str = "pending";
    pub const ACCEPTED: &'static str = "accepted";
}

/// Helper to parse path parameters safely.
pub fn parse_param<T: std::str::FromStr>(req: &Request, name: &str) -> Result<T, FriendError> {
    req.param::<String>(name)
        .ok_or_else(|| FriendError::InvalidParam(format!("missing {}", name)))?
        .parse::<T>()
        .map_err(|_| FriendError::InvalidParam(format!("invalid {}", name)))
}

/// Maximum number of results returned by list endpoints.
pub const MAX_LIST_RESULTS: i64 = 100;

#[derive(Debug, Deserialize, ToSchema)]
pub struct SendFriendRequestInput {
    pub user_id: Option<i32>,
    pub nickname: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FriendRequestResponse {
    pub id: i32,
    pub sender: PublicUser,
    pub receiver: PublicUser,
    pub status: String,
    pub created_at: chrono::NaiveDateTime,
}

impl FriendRequestResponse {
    pub fn new(
        request: &crate::models::FriendRequest,
        sender: User,
        receiver: User,
    ) -> Self {
        Self {
            id: request.id,
            sender: PublicUser::from(sender),
            receiver: PublicUser::from(receiver),
            status: request.status.clone(),
            created_at: request.created_at().naive_utc(),
        }
    }
}
