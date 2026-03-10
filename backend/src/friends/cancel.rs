//! DELETE /api/friends/request/{request_id} - Cancel a friend request

use crate::error::FriendError;
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use crate::models::FriendRequestStatus;
use salvo::oapi::extract::PathParam;

use super::types::{find_pending_request, send_notification};

/// Cancel a friend request you sent (deletes the request)
#[endpoint]
pub async fn cancel_friend_request(
    depot: &mut Depot,
    request_id: PathParam<i32>,
    db: Db,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let user_id = depot.session().user_id;
    let request_id = request_id.into_inner();

    let receiver_id = db
        .write(move |conn| {
            let request = find_pending_request(conn, request_id, user_id, true)?;
            let receiver_id = request.receiver_id;

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

            Ok::<_, ApiError>(receiver_id)
        })
        .await??;

    send_notification(
        depot,
        receiver_id,
        NotificationPayload::FriendRequestCancelled { request_id },
    )
    .await;

    json_ok(())
}
