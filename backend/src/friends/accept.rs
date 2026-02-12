//! POST /api/friends/accept/<request_id> - Accept a friend request

use crate::models::{FriendRequest, User};
use crate::prelude::*;

use super::types::{FriendRequestResponse, RequestStatus, find_pending_request, parse_param};

/// Accept a friend request
#[endpoint]
pub async fn accept_friend_request(
    depot: &mut Depot,
    req: &mut Request,
    db: Db,
) -> JsonResult<FriendRequestResponse> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let user_id = depot.session().user_id;
    let request_id: i32 = parse_param(req, "request_id")?;

    let (updated_request, sender, receiver) = db
        .write(move |conn| {
            let request = find_pending_request(conn, request_id, user_id, false)?;

            // Update status to accepted
            let now = chrono::Utc::now().naive_utc();
            let updated_request: FriendRequest =
                diesel::update(fr::friend_requests.filter(fr::id.eq(request_id)))
                    .set((
                        fr::status.eq(RequestStatus::ACCEPTED),
                        fr::updated_at.eq(now),
                    ))
                    .get_result(conn)?;

            let sender: User = u::users.filter(u::id.eq(request.sender_id)).first(conn)?;
            let receiver: User = u::users.filter(u::id.eq(request.receiver_id)).first(conn)?;

            Ok::<_, ApiError>((updated_request, sender, receiver))
        })
        .await??;

    json_ok(FriendRequestResponse::new(
        &updated_request,
        sender,
        receiver,
    ))
}
