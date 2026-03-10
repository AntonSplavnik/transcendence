//! DELETE /api/friends/remove/{user_id} - Remove a friend

use crate::error::FriendError;
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use crate::models::FriendRequestStatus;
use salvo::oapi::extract::PathParam;

use super::types::send_notification;

/// Remove a friend
#[endpoint]
pub async fn remove_friend(depot: &mut Depot, user_id: PathParam<i32>, db: Db) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let friend_id = user_id.into_inner();
    let user_id = depot.session().user_id;

    db.write(move |conn| {
        // Atomically delete the accepted friendship in either direction.
        // Combining the lookup and delete into one query prevents a race
        // condition where two concurrent removals could both SELECT the same
        // row, then one DELETE succeeds while the other silently deletes
        // nothing — yet both would have returned Ok with the two-step approach.
        let deleted = diesel::delete(
            fr::friend_requests
                .filter(fr::status.eq(FriendRequestStatus::Accepted))
                .filter(
                    fr::sender_id
                        .eq(user_id)
                        .and(fr::receiver_id.eq(friend_id))
                        .or(fr::sender_id.eq(friend_id).and(fr::receiver_id.eq(user_id))),
                ),
        )
        .execute(conn)?;

        if deleted == 0 {
            return Err(FriendError::NotFriends.into());
        }

        Ok::<_, ApiError>(())
    })
    .await??;

    send_notification(
        depot,
        friend_id,
        NotificationPayload::FriendRemoved { user_id },
    )
    .await;

    json_ok(())
}
