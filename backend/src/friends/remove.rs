//! DELETE /api/friends/remove/{user_id} - Remove a friend

use crate::error::FriendError;
use crate::models::FriendRequest;
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use crate::models::FriendRequestStatus;
use salvo::oapi::extract::PathParam;

use super::types::send_notification;

/// Remove a friend
#[endpoint]
pub async fn remove_friend(
    depot: &mut Depot,
    user_id: PathParam<i32>,
    db: Db,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let friend_id = user_id.into_inner();
    let user_id = depot.session().user_id;

    db.write(move |conn| {
        // Find accepted friendship in either direction
        let friendship: FriendRequest = fr::friend_requests
            .filter(fr::status.eq(FriendRequestStatus::ACCEPTED))
            .filter(
                fr::sender_id
                    .eq(user_id)
                    .and(fr::receiver_id.eq(friend_id))
                    .or(fr::sender_id.eq(friend_id).and(fr::receiver_id.eq(user_id))),
            )
            .first(conn)
            .optional()?
            .ok_or(FriendError::NotFriends)?;

        // Delete the friendship
        diesel::delete(fr::friend_requests.filter(fr::id.eq(friendship.id))).execute(conn)?;

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
