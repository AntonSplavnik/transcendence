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
) -> JsonResult<FriendRequestResponse> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let session = depot.session();
    let sender_id = session.user_id;
    let input = json.into_inner();

    let conn = &mut db::get()?;

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

    // Use transaction to prevent race conditions
    let request: FriendRequest = conn.transaction(|conn| {
        // Check if already friends
        let already_friends: bool = diesel::select(diesel::dsl::exists(
            fr::friend_requests
                .filter(fr::status.eq(RequestStatus::ACCEPTED))
                .filter(
                    fr::sender_id.eq(sender_id).and(fr::receiver_id.eq(receiver_id))
                        .or(fr::sender_id.eq(receiver_id).and(fr::receiver_id.eq(sender_id))),
                ),
        ))
        .get_result(conn)?;

        if already_friends {
            return Err(diesel::result::Error::RollbackTransaction);
        }

        // Check if pending request exists
        let existing: Option<FriendRequest> = fr::friend_requests
            .filter(fr::status.eq(RequestStatus::PENDING))
            .filter(
                fr::sender_id.eq(sender_id).and(fr::receiver_id.eq(receiver_id))
                    .or(fr::sender_id.eq(receiver_id).and(fr::receiver_id.eq(sender_id))),
            )
            .first(conn)
            .optional()?;

        if existing.is_some() {
            return Err(diesel::result::Error::RollbackTransaction);
        }

        // Create the request
        let new_request = NewFriendRequest::new(sender_id, receiver_id);
        diesel::insert_into(fr::friend_requests)
            .values(&new_request)
            .get_result(conn)
    }).map_err(|e| match e {
        diesel::result::Error::RollbackTransaction => {
            // Re-check to return proper error
            let conn = &mut db::get().unwrap();
            let already_friends: bool = diesel::select(diesel::dsl::exists(
                fr::friend_requests
                    .filter(fr::status.eq(RequestStatus::ACCEPTED))
                    .filter(
                        fr::sender_id.eq(sender_id).and(fr::receiver_id.eq(receiver_id))
                            .or(fr::sender_id.eq(receiver_id).and(fr::receiver_id.eq(sender_id))),
                    ),
            ))
            .get_result(conn)
            .unwrap_or(false);

            if already_friends {
                ApiError::Friend(FriendError::AlreadyFriends)
            } else {
                ApiError::Friend(FriendError::DuplicateRequest)
            }
        }
        other => ApiError::DatabaseSQL(other),
    })?;

    let sender: User = u::users.filter(u::id.eq(sender_id)).first(conn)?;

    json_ok(FriendRequestResponse::new(&request, sender, receiver))
}
