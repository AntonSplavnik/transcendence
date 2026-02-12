//! DELETE /api/friends/request/<request_id> - Cancel a friend request

use crate::error::FriendError;
use crate::models::FriendRequest;
use crate::prelude::*;

use super::types::{parse_param, RequestStatus};

/// Cancel a friend request you sent (deletes the request)
#[endpoint]
pub async fn cancel_friend_request(
    depot: &mut Depot,
    req: &mut Request,
    db: Db,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let user_id = depot.session().user_id;
    let request_id: i32 = parse_param(req, "request_id")?;

    db.write(move |conn| {
        // Find the request
        let request: FriendRequest = fr::friend_requests
            .filter(fr::id.eq(request_id))
            .first(conn)
            .optional()?
            .ok_or(FriendError::RequestNotFound)?;

        // Only the sender can cancel
        if request.sender_id != user_id {
            return Err(FriendError::NotAuthorized.into());
        }

        // Must be pending
        if request.status != RequestStatus::PENDING {
            return Err(FriendError::RequestNotPending.into());
        }

        // Delete the request
        diesel::delete(fr::friend_requests.filter(fr::id.eq(request_id))).execute(conn)?;

        Ok::<_, ApiError>(())
    })
    .await??;

    json_ok(())
}
