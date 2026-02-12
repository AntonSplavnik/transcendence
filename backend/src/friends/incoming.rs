//! GET /api/friends/requests/incoming - Get incoming friend requests

use crate::models::{FriendRequest, User};
use crate::prelude::*;

use super::types::{FriendRequestResponse, MAX_LIST_RESULTS, RequestStatus};

/// Get incoming friend requests
#[endpoint]
pub async fn get_incoming_requests(
    depot: &mut Depot,
    db: Db,
) -> JsonResult<Vec<FriendRequestResponse>> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let user_id = depot.session().user_id;

    let result = db
        .read(move |conn| {
            // Get pending requests where user is receiver
            let requests: Vec<FriendRequest> = fr::friend_requests
                .filter(fr::receiver_id.eq(user_id))
                .filter(fr::status.eq(RequestStatus::PENDING))
                .order(fr::created_at.desc())
                .limit(MAX_LIST_RESULTS)
                .load(conn)?;

            let sender_ids: Vec<i32> = requests.iter().map(|r| r.sender_id).collect();
            let senders: Vec<User> = u::users.filter(u::id.eq_any(&sender_ids)).load(conn)?;

            let receiver: User = u::users.filter(u::id.eq(user_id)).first(conn)?;

            Ok::<_, ApiError>(
                requests
                    .iter()
                    .filter_map(|request| {
                        let sender =
                            senders.iter().find(|s| s.id == request.sender_id)?.clone();
                        Some(FriendRequestResponse::new(request, sender, receiver.clone()))
                    })
                    .collect(),
            )
        })
        .await??;

    json_ok(result)
}
