//! GET /api/friends/requests/incoming - Get incoming friend requests

use crate::models::{FriendRequest, User};
use crate::prelude::*;

use super::types::{FriendRequestResponse, RequestStatus};

/// Get incoming friend requests
#[endpoint]
pub async fn get_incoming_requests(depot: &mut Depot) -> JsonResult<Vec<FriendRequestResponse>> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let session = depot.session();
    let user_id = session.user_id;

    let conn = &mut db::get()?;

    // Get pending requests where user is receiver
    let requests: Vec<FriendRequest> = fr::friend_requests
        .filter(fr::receiver_id.eq(user_id))
        .filter(fr::status.eq(RequestStatus::PENDING))
        .order(fr::created_at.desc())
        .load(conn)?;

    let sender_ids: Vec<i32> = requests.iter().map(|r| r.sender_id).collect();
    let senders: Vec<User> = u::users.filter(u::id.eq_any(&sender_ids)).load(conn)?;

    let receiver: User = u::users.filter(u::id.eq(user_id)).first(conn)?;

    let result: Vec<FriendRequestResponse> = requests
        .iter()
        .filter_map(|request| {
            let sender = senders.iter().find(|s| s.id == request.sender_id)?.clone();
            Some(FriendRequestResponse::new(request, sender, receiver.clone()))
        })
        .collect();

    json_ok(result)
}
