//! POST /api/friends/reject/{request_id} - Reject a friend request

use crate::error::FriendError;
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use crate::models::FriendRequestStatus;
use salvo::oapi::extract::PathParam;

use super::types::{find_pending_request, send_notification};

/// Reject a friend request
#[endpoint]
pub async fn reject_friend_request(
    depot: &mut Depot,
    request_id: PathParam<i32>,
    db: Db,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let user_id = depot.session().user_id;
    let request_id = request_id.into_inner();

    let sender_id = db
        .write(move |conn| {
            let request = find_pending_request(conn, request_id, user_id, false)?;
            let sender_id = request.sender_id;

            // Atomically delete: re-check pending status to prevent deleting accepted requests
            let deleted_count = diesel::delete(
                fr::friend_requests
                    .filter(fr::id.eq(request.id))
                    .filter(fr::status.eq(FriendRequestStatus::Pending)),
            )
            .execute(conn)?;

            if deleted_count == 0 {
                return Err(FriendError::RequestNotPending.into());
            }

            Ok::<_, ApiError>(sender_id)
        })
        .await??;

    send_notification(
        depot,
        sender_id,
        NotificationPayload::FriendRequestRejected { request_id },
    )
    .await;

    json_ok(())
}
