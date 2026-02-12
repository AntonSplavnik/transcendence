//! DELETE /api/friends/<user_id> - Remove a friend

use crate::error::FriendError;
use crate::models::FriendRequest;
use crate::prelude::*;

use super::types::{parse_param, RequestStatus};

/// Remove a friend
#[endpoint]
pub async fn remove_friend(
    depot: &mut Depot,
    req: &mut Request,
    db: Db,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let user_id = depot.session().user_id;
    let friend_id: i32 = parse_param(req, "user_id")?;

    db.write(move |conn| {
        // Find accepted friendship in either direction
        let friendship: FriendRequest = fr::friend_requests
            .filter(fr::status.eq(RequestStatus::ACCEPTED))
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

    json_ok(())
}
