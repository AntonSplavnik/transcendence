//! POST /api/friends/request - Send a friend request

use diesel::result::{DatabaseErrorKind, Error as DieselError};

use crate::error::FriendError;
use crate::models::{FriendRequest, NewFriendRequest, User};
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use super::types::{
    FriendRequestResponse, MAX_PENDING_REQUESTS, RequestStatus, SendFriendRequestInput,
};

/// Send a friend request to another user
///
/// Provide either `user_id` or `nickname` to identify the target user.
#[endpoint]
pub async fn send_friend_request(
    depot: &mut Depot,
    json: JsonBody<SendFriendRequestInput>,
    db: Db,
) -> JsonResult<FriendRequestResponse> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let sender_id = depot.session().user_id;
    let input = json.into_inner();
    input.validate()?;
    input.validate_target()?;

    let (request, sender, receiver) = db
        .write(move |conn| {
            // Find the target user
            let receiver: User = match (input.user_id, input.nickname) {
                (Some(id), _) => u::users
                    .filter(u::id.eq(id))
                    .first(conn)
                    .optional()?
                    .ok_or(FriendError::UserNotFound)?,
                (_, Some(nick)) => u::users
                    .filter(u::nickname.eq(&nick))
                    .first(conn)
                    .optional()?
                    .ok_or(FriendError::UserNotFound)?,
                (None, None) => return Err(FriendError::UserNotFound.into()),
            };

            let receiver_id = receiver.id;

            // Cannot send request to self
            if sender_id == receiver_id {
                return Err(FriendError::SelfRequest.into());
            }

            // Check if already friends
            let already_friends: bool = diesel::select(diesel::dsl::exists(
                fr::friend_requests
                    .filter(fr::status.eq(RequestStatus::ACCEPTED))
                    .filter(
                        fr::sender_id
                            .eq(sender_id)
                            .and(fr::receiver_id.eq(receiver_id))
                            .or(fr::sender_id
                                .eq(receiver_id)
                                .and(fr::receiver_id.eq(sender_id))),
                    ),
            ))
            .get_result(conn)?;

            if already_friends {
                return Err(FriendError::AlreadyFriends.into());
            }

            // Check spam: limit pending requests per user
            let pending_count: i64 = fr::friend_requests
                .filter(fr::sender_id.eq(sender_id))
                .filter(fr::status.eq(RequestStatus::PENDING))
                .count()
                .get_result(conn)?;

            if pending_count >= MAX_PENDING_REQUESTS {
                return Err(FriendError::TooManyPending.into());
            }

            // Create the request — catch UniqueViolation from the DB constraint
            let new_request = NewFriendRequest::new(sender_id, receiver_id);
            let request: FriendRequest = diesel::insert_into(fr::friend_requests)
                .values(&new_request)
                .get_result(conn)
                .map_err(|e| match e {
                    DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _) => {
                        ApiError::Friend(FriendError::DuplicateRequest)
                    }
                    other => ApiError::DatabaseQuery(other),
                })?;

            let sender: User = u::users.filter(u::id.eq(sender_id)).first(conn)?;

            Ok::<_, ApiError>((request, sender, receiver))
        })
        .await??;

    let nm = depot.notification_manager();
    let db = depot.db();
    if let Err(e) = nm
        .send(
            &db,
            receiver.id,
            NotificationPayload::FriendRequestReceived {
                request_id: request.id,
                sender_id: sender.id,
            },
        )
        .await
    {
        tracing::warn!(error = %e, "failed to send friend request notification");
    }

    let sm = depot.stream_manager();
    let sender_online = sm.is_connected(sender.id);
    let receiver_online = sm.is_connected(receiver.id);
    json_ok(FriendRequestResponse::new(
        &request,
        sender,
        receiver,
        sender_online,
        receiver_online,
    ))
}
