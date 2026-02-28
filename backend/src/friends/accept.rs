//! POST /api/friends/accept/{request_id} - Accept a friend request

use crate::models::{FriendRequest, User};
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use crate::error::FriendError;

use super::types::{
    FriendRequestResponse, MAX_FRIENDS, RequestStatus, find_pending_request, parse_param,
    send_notification,
};

/// Accept a friend request
#[endpoint(parameters(("request_id" = i32, description = "Friend request ID")))]
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

            // Reject if either party has already reached the friend limit
            let sender_count: i64 = fr::friend_requests
                .filter(fr::status.eq(RequestStatus::ACCEPTED))
                .filter(
                    fr::sender_id
                        .eq(request.sender_id)
                        .or(fr::receiver_id.eq(request.sender_id)),
                )
                .count()
                .get_result(conn)?;

            let receiver_count: i64 = fr::friend_requests
                .filter(fr::status.eq(RequestStatus::ACCEPTED))
                .filter(
                    fr::sender_id
                        .eq(request.receiver_id)
                        .or(fr::receiver_id.eq(request.receiver_id)),
                )
                .count()
                .get_result(conn)?;

            if sender_count >= MAX_FRIENDS || receiver_count >= MAX_FRIENDS {
                return Err(FriendError::FriendListFull.into());
            }

            // Atomically update: re-check pending status in WHERE to prevent races
            let now = chrono::Utc::now();
            let updated_count = diesel::update(
                fr::friend_requests
                    .filter(fr::id.eq(request_id))
                    .filter(fr::status.eq(RequestStatus::PENDING)),
            )
            .set((
                fr::status.eq(RequestStatus::ACCEPTED),
                fr::updated_at.eq(now),
            ))
            .execute(conn)?;

            if updated_count == 0 {
                return Err(FriendError::RequestNotPending.into());
            }

            let updated_request: FriendRequest = fr::friend_requests
                .filter(fr::id.eq(request_id))
                .first(conn)?;

            let sender: User = u::users.filter(u::id.eq(request.sender_id)).first(conn)?;
            let receiver: User = u::users.filter(u::id.eq(request.receiver_id)).first(conn)?;

            Ok::<_, ApiError>((updated_request, sender, receiver))
        })
        .await??;

    send_notification(
        depot,
        updated_request.sender_id,
        NotificationPayload::FriendRequestAccepted {
            request_id: updated_request.id,
            friend_id: updated_request.receiver_id,
        },
    )
    .await;

    let sm = depot.stream_manager();
    let sender_online = sm.is_connected(sender.id);
    let receiver_online = sm.is_connected(receiver.id);
    json_ok(FriendRequestResponse::new(
        &updated_request,
        sender,
        receiver,
        sender_online,
        receiver_online,
    ))
}
