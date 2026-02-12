//! GET /api/friends/requests/outgoing - Get outgoing friend requests

use crate::models::{FriendRequest, User};
use crate::prelude::*;

use super::types::{FriendRequestResponse, MAX_LIST_RESULTS, RequestStatus};

/// Get outgoing friend requests
#[endpoint]
pub async fn get_outgoing_requests(
    depot: &mut Depot,
    db: Db,
) -> JsonResult<Vec<FriendRequestResponse>> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let user_id = depot.session().user_id;

    let result = db
        .read(move |conn| {
            // Get pending requests where user is sender
            let requests: Vec<FriendRequest> = fr::friend_requests
                .filter(fr::sender_id.eq(user_id))
                .filter(fr::status.eq(RequestStatus::PENDING))
                .order(fr::created_at.desc())
                .limit(MAX_LIST_RESULTS)
                .load(conn)?;

            let receiver_ids: Vec<i32> = requests.iter().map(|r| r.receiver_id).collect();
            let receivers: Vec<User> =
                u::users.filter(u::id.eq_any(&receiver_ids)).load(conn)?;

            let sender: User = u::users.filter(u::id.eq(user_id)).first(conn)?;

            Ok::<_, ApiError>(
                requests
                    .iter()
                    .filter_map(|request| {
                        let receiver = receivers
                            .iter()
                            .find(|r| r.id == request.receiver_id)?
                            .clone();
                        Some(FriendRequestResponse::new(
                            request,
                            sender.clone(),
                            receiver,
                        ))
                    })
                    .collect(),
            )
        })
        .await??;

    json_ok(result)
}
