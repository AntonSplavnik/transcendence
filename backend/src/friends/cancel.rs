//! DELETE /api/friends/request/<request_id> - Cancel a friend request

use crate::notifications::NotificationPayload;
use crate::prelude::*;

use super::types::{find_pending_request, parse_param};

/// Cancel a friend request you sent (deletes the request)
#[endpoint]
pub async fn cancel_friend_request(depot: &mut Depot, req: &mut Request, db: Db) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let user_id = depot.session().user_id;
    let request_id: i32 = parse_param(req, "request_id")?;

    let receiver_id = db
        .write(move |conn| {
            let request = find_pending_request(conn, request_id, user_id, true)?;
            let receiver_id = request.receiver_id;

            // Delete the request
            diesel::delete(fr::friend_requests.filter(fr::id.eq(request.id))).execute(conn)?;

            Ok::<_, ApiError>(receiver_id)
        })
        .await??;

    let nm = depot.notification_manager();
    let db = depot.db();
    if let Err(e) = nm
        .send(
            &db,
            receiver_id,
            NotificationPayload::FriendRequestCancelled { request_id },
        )
        .await
    {
        tracing::warn!(error = %e, "failed to send friend request cancelled notification");
    }

    json_ok(())
}
