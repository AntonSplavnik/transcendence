//! POST /api/friends/request - Send a friend request

use crate::error::FriendError;
use crate::models::{FriendRequest, NewFriendRequest, User};
use crate::prelude::*;

use super::types::{FriendRequestResponse, RequestStatus, SendFriendRequestInput};

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

            // Check if pending request exists
            let existing: Option<FriendRequest> = fr::friend_requests
                .filter(fr::status.eq(RequestStatus::PENDING))
                .filter(
                    fr::sender_id
                        .eq(sender_id)
                        .and(fr::receiver_id.eq(receiver_id))
                        .or(fr::sender_id
                            .eq(receiver_id)
                            .and(fr::receiver_id.eq(sender_id))),
                )
                .first(conn)
                .optional()?;

            if existing.is_some() {
                return Err(FriendError::DuplicateRequest.into());
            }

            // Create the request
            let new_request = NewFriendRequest::new(sender_id, receiver_id);
            let request: FriendRequest = diesel::insert_into(fr::friend_requests)
                .values(&new_request)
                .get_result(conn)?;

            let sender: User = u::users.filter(u::id.eq(sender_id)).first(conn)?;

            Ok::<_, ApiError>((request, sender, receiver))
        })
        .await??;

    json_ok(FriendRequestResponse::new(&request, sender, receiver))
}
