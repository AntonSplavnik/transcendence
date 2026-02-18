//! Types and helpers for the friends module.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::db::DepotDatabaseExt;
use crate::error::FriendError;
use crate::models::nickname::Nickname;
use crate::models::{FriendRequest, User};
use crate::notifications::{NotificationManagerDepotExt, NotificationPayload};
use crate::prelude::*;
use crate::routers::users::PublicUser;
use crate::stream::StreamManager;

/// Friend request status values stored in the database.
pub struct RequestStatus;

impl RequestStatus {
    pub const PENDING: &'static str = "pending";
    pub const ACCEPTED: &'static str = "accepted";
}

/// Maximum number of results returned by list endpoints.
pub const MAX_LIST_RESULTS: i64 = 100;

/// Maximum number of pending friend requests a user can have.
pub const MAX_PENDING_REQUESTS: i64 = 50;

/// Helper to parse path parameters safely.
pub fn parse_param<T: std::str::FromStr>(req: &Request, name: &str) -> Result<T, FriendError> {
    req.param::<String>(name)
        .ok_or_else(|| FriendError::InvalidParam(format!("missing {}", name)))?
        .parse::<T>()
        .map_err(|_| FriendError::InvalidParam(format!("invalid {}", name)))
}

/// Send a notification, logging a warning on failure.
pub async fn send_notification(depot: &Depot, target_id: i32, payload: NotificationPayload) {
    let nm = depot.notification_manager();
    let db = depot.db();
    if let Err(e) = nm.send(db, target_id, payload).await {
        tracing::warn!(error = %e, target_id, "failed to send friend notification");
    }
}

/// Find a pending friend request and verify ownership.
///
/// `must_be_sender`: if true, the user must be the sender (cancel);
/// if false, the user must be the receiver (accept/reject).
pub fn find_pending_request(
    conn: &mut DbConn,
    request_id: i32,
    user_id: i32,
    must_be_sender: bool,
) -> Result<FriendRequest, ApiError> {
    use crate::schema::friend_requests::dsl as fr;

    let request: FriendRequest = fr::friend_requests
        .filter(fr::id.eq(request_id))
        .first(conn)
        .optional()?
        .ok_or(FriendError::RequestNotFound)?;

    let authorized = if must_be_sender {
        request.sender_id == user_id
    } else {
        request.receiver_id == user_id
    };
    if !authorized {
        return Err(FriendError::NotAuthorized.into());
    }

    if request.status != RequestStatus::PENDING {
        return Err(FriendError::RequestNotPending.into());
    }

    Ok(request)
}

/// Direction for loading pending friend requests.
pub enum RequestDirection {
    /// Requests received by the user.
    Incoming,
    /// Requests sent by the user.
    Outgoing,
}

/// Load pending friend requests with associated user data.
pub fn load_pending_requests(
    conn: &mut DbConn,
    user_id: i32,
    direction: RequestDirection,
    sm: &Arc<StreamManager>,
) -> Result<Vec<FriendRequestResponse>, ApiError> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let requests: Vec<FriendRequest> = match direction {
        RequestDirection::Incoming => fr::friend_requests
            .filter(fr::receiver_id.eq(user_id))
            .filter(fr::status.eq(RequestStatus::PENDING))
            .order(fr::created_at.desc())
            .limit(MAX_LIST_RESULTS)
            .load(conn)?,
        RequestDirection::Outgoing => fr::friend_requests
            .filter(fr::sender_id.eq(user_id))
            .filter(fr::status.eq(RequestStatus::PENDING))
            .order(fr::created_at.desc())
            .limit(MAX_LIST_RESULTS)
            .load(conn)?,
    };

    if requests.is_empty() {
        return Ok(Vec::new());
    }

    // Load the "other" users in a HashMap for O(1) lookup
    let other_ids: Vec<i32> = requests
        .iter()
        .map(|r| match direction {
            RequestDirection::Incoming => r.sender_id,
            RequestDirection::Outgoing => r.receiver_id,
        })
        .collect();

    let others: HashMap<i32, User> = u::users
        .filter(u::id.eq_any(&other_ids))
        .load::<User>(conn)?
        .into_iter()
        .map(|user| (user.id, user))
        .collect();

    let current_user: User = u::users.filter(u::id.eq(user_id)).first(conn)?;

    let result = requests
        .iter()
        .filter_map(|request| {
            let other_id = match direction {
                RequestDirection::Incoming => request.sender_id,
                RequestDirection::Outgoing => request.receiver_id,
            };
            let other = match others.get(&other_id) {
                Some(user) => user.clone(),
                None => {
                    tracing::warn!(
                        request_id = request.id,
                        user_id = other_id,
                        "friend request references missing user, skipping"
                    );
                    return None;
                }
            };
            let (sender, receiver) = match direction {
                RequestDirection::Incoming => (other, current_user.clone()),
                RequestDirection::Outgoing => (current_user.clone(), other),
            };
            let sender_online = sm.is_connected(sender.id);
            let receiver_online = sm.is_connected(receiver.id);
            Some(FriendRequestResponse::new(
                request,
                sender,
                receiver,
                sender_online,
                receiver_online,
            ))
        })
        .collect();

    Ok(result)
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct SendFriendRequestInput {
    pub user_id: Option<i32>,
    #[validate(custom(function = "crate::validate::nickname"))]
    pub nickname: Option<Nickname>,
}

impl SendFriendRequestInput {
    /// Validate that at least one identifier is provided.
    pub fn validate_target(&self) -> Result<(), FriendError> {
        if self.user_id.is_none() && self.nickname.as_ref().is_none_or(|n| n.is_empty()) {
            return Err(FriendError::InvalidParam(
                "provide either user_id or nickname".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FriendRequestResponse {
    pub id: i32,
    pub sender: PublicUser,
    pub receiver: PublicUser,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl FriendRequestResponse {
    pub fn new(
        request: &FriendRequest,
        sender: User,
        receiver: User,
        sender_online: bool,
        receiver_online: bool,
    ) -> Self {
        Self {
            id: request.id,
            sender: PublicUser::new(sender, sender_online),
            receiver: PublicUser::new(receiver, receiver_online),
            status: request.status.clone(),
            created_at: request.created_at,
            updated_at: request.updated_at,
        }
    }
}
