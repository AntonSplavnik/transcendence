//! Friend system routes and handlers.
//!
//! Provides endpoints for managing friend requests and friend lists.

use crate::error::FriendError;
use crate::models::{FriendRequest, NewFriendRequest, User};
use crate::prelude::*;
use crate::routers::users::PublicUser;

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("friends")
        .requires_user_login()
        .push(
            Router::with_path("request")
                .user_rate_limit(&RateLimit::per_minute(30))
                .post(send_friend_request)
                .push(
                    Router::with_path("<request_id>")
                        .user_rate_limit(&RateLimit::per_minute(30))
                        .delete(cancel_friend_request),
                ),
        )
        .push(
            Router::with_path("accept/<request_id>")
                .user_rate_limit(&RateLimit::per_minute(30))
                .post(accept_friend_request),
        )
        .push(
            Router::with_path("reject/<request_id>")
                .user_rate_limit(&RateLimit::per_minute(30))
                .post(reject_friend_request),
        )
        .push(
            Router::with_path("<user_id>")
                .user_rate_limit(&RateLimit::per_minute(30))
                .delete(remove_friend),
        )
        .push(
            Router::new()
                .user_rate_limit(&RateLimit::per_minute(60))
                .get(get_friends),
        )
        .push(
            Router::with_path("requests/incoming")
                .user_rate_limit(&RateLimit::per_minute(60))
                .get(get_incoming_requests),
        )
        .push(
            Router::with_path("requests/outgoing")
                .user_rate_limit(&RateLimit::per_minute(60))
                .get(get_outgoing_requests),
        )
}

#[derive(Debug, Deserialize, ToSchema)]
struct SendFriendRequestInput {
    user_id: Option<i32>,
    nickname: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
struct FriendRequestResponse {
    id: i32,
    sender: PublicUser,
    receiver: PublicUser,
    status: String,
    created_at: chrono::NaiveDateTime,
}

impl FriendRequestResponse {
    fn from_request_and_users(
        request: &FriendRequest,
        sender: User,
        receiver: User,
    ) -> Self {
        Self {
            id: request.id,
            sender: PublicUser::from(sender),
            receiver: PublicUser::from(receiver),
            status: request.status.clone(),
            created_at: request.created_at().naive_utc(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
struct FriendWithStatus {
    #[serde(flatten)]
    user: PublicUser,
}

/// Send a friend request to another user
///
/// Provide either `user_id` or `nickname` to identify the target user.
#[endpoint]
async fn send_friend_request(
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

    // Check if already friends (accepted request in either direction)
    let already_friends: bool = diesel::select(diesel::dsl::exists(
        fr::friend_requests
            .filter(fr::status.eq("accepted"))
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

    // Check if a pending request already exists in either direction
    let existing_request: Option<FriendRequest> = fr::friend_requests
        .filter(fr::status.eq("pending"))
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

    if existing_request.is_some() {
        return Err(FriendError::DuplicateRequest.into());
    }

    // Create the friend request
    let new_request = NewFriendRequest::new(sender_id, receiver_id);
    diesel::insert_into(fr::friend_requests)
        .values(&new_request)
        .execute(conn)?;

    let request: FriendRequest = fr::friend_requests
        .order(fr::id.desc())
        .first(conn)?;

    let sender: User = u::users.filter(u::id.eq(sender_id)).first(conn)?;

    json_ok(FriendRequestResponse::from_request_and_users(
        &request, sender, receiver,
    ))
}

/// Accept a friend request
#[endpoint]
async fn accept_friend_request(
    depot: &mut Depot,
    req: &mut Request,
) -> JsonResult<FriendRequestResponse> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let session = depot.session();
    let user_id = session.user_id;
    let request_id: i32 = req.param("request_id").unwrap();

    let conn = &mut db::get()?;

    // Find the request
    let request: FriendRequest = fr::friend_requests
        .filter(fr::id.eq(request_id))
        .first(conn)
        .optional()?
        .ok_or(FriendError::RequestNotFound)?;

    // Only the receiver can accept
    if request.receiver_id != user_id {
        return Err(FriendError::NotAuthorized.into());
    }

    // Must be pending
    if request.status != "pending" {
        return Err(FriendError::RequestNotFound.into());
    }

    // Update status to accepted
    let now = chrono::Utc::now().naive_utc();
    diesel::update(fr::friend_requests.filter(fr::id.eq(request_id)))
        .set((fr::status.eq("accepted"), fr::updated_at.eq(now)))
        .execute(conn)?;

    let updated_request: FriendRequest =
        fr::friend_requests.filter(fr::id.eq(request_id)).first(conn)?;

    let sender: User = u::users.filter(u::id.eq(request.sender_id)).first(conn)?;
    let receiver: User = u::users.filter(u::id.eq(request.receiver_id)).first(conn)?;

    json_ok(FriendRequestResponse::from_request_and_users(
        &updated_request,
        sender,
        receiver,
    ))
}

/// Reject a friend request
#[endpoint]
async fn reject_friend_request(
    depot: &mut Depot,
    req: &mut Request,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let session = depot.session();
    let user_id = session.user_id;
    let request_id: i32 = req.param("request_id").unwrap();

    let conn = &mut db::get()?;

    // Find the request
    let request: FriendRequest = fr::friend_requests
        .filter(fr::id.eq(request_id))
        .first(conn)
        .optional()?
        .ok_or(FriendError::RequestNotFound)?;

    // Only the receiver can reject
    if request.receiver_id != user_id {
        return Err(FriendError::NotAuthorized.into());
    }

    // Must be pending
    if request.status != "pending" {
        return Err(FriendError::RequestNotFound.into());
    }

    // Update status to rejected
    let now = chrono::Utc::now().naive_utc();
    diesel::update(fr::friend_requests.filter(fr::id.eq(request_id)))
        .set((fr::status.eq("rejected"), fr::updated_at.eq(now)))
        .execute(conn)?;

    json_ok(())
}

/// Cancel a friend request you sent
#[endpoint]
async fn cancel_friend_request(
    depot: &mut Depot,
    req: &mut Request,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let session = depot.session();
    let user_id = session.user_id;
    let request_id: i32 = req.param("request_id").unwrap();

    let conn = &mut db::get()?;

    // Find the request
    let request: FriendRequest = fr::friend_requests
        .filter(fr::id.eq(request_id))
        .first(conn)
        .optional()?
        .ok_or(FriendError::RequestNotFound)?;

    // Only the sender can cancel
    if request.sender_id != user_id {
        return Err(FriendError::NotAuthorized.into());
    }

    // Must be pending
    if request.status != "pending" {
        return Err(FriendError::RequestNotFound.into());
    }

    // Delete the request
    diesel::delete(fr::friend_requests.filter(fr::id.eq(request_id))).execute(conn)?;

    json_ok(())
}

/// Remove a friend
#[endpoint]
async fn remove_friend(
    depot: &mut Depot,
    req: &mut Request,
) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let session = depot.session();
    let user_id = session.user_id;
    let friend_id: i32 = req.param("user_id").unwrap();

    let conn = &mut db::get()?;

    // Find accepted friendship in either direction
    let friendship: Option<FriendRequest> = fr::friend_requests
        .filter(fr::status.eq("accepted"))
        .filter(
            fr::sender_id
                .eq(user_id)
                .and(fr::receiver_id.eq(friend_id))
                .or(fr::sender_id
                    .eq(friend_id)
                    .and(fr::receiver_id.eq(user_id))),
        )
        .first(conn)
        .optional()?;

    let friendship = friendship.ok_or(FriendError::NotFriends)?;

    // Delete the friendship
    diesel::delete(fr::friend_requests.filter(fr::id.eq(friendship.id))).execute(conn)?;

    json_ok(())
}

/// Get list of friends
#[endpoint]
async fn get_friends(depot: &mut Depot) -> JsonResult<Vec<FriendWithStatus>> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let session = depot.session();
    let user_id = session.user_id;

    let conn = &mut db::get()?;

    // Get all accepted friend requests where user is either sender or receiver
    let friendships: Vec<FriendRequest> = fr::friend_requests
        .filter(fr::status.eq("accepted"))
        .filter(
            fr::sender_id
                .eq(user_id)
                .or(fr::receiver_id.eq(user_id)),
        )
        .load(conn)?;

    // Extract friend IDs (the other person in each friendship)
    let friend_ids: Vec<i32> = friendships
        .iter()
        .map(|f| {
            if f.sender_id == user_id {
                f.receiver_id
            } else {
                f.sender_id
            }
        })
        .collect();

    // Load friend users
    let friends: Vec<User> = u::users
        .filter(u::id.eq_any(&friend_ids))
        .load(conn)?;

    let result: Vec<FriendWithStatus> = friends
        .into_iter()
        .map(|user| FriendWithStatus {
            user: PublicUser::from(user),
        })
        .collect();

    json_ok(result)
}

/// Get incoming friend requests
#[endpoint]
async fn get_incoming_requests(
    depot: &mut Depot,
) -> JsonResult<Vec<FriendRequestResponse>> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let session = depot.session();
    let user_id = session.user_id;

    let conn = &mut db::get()?;

    // Get pending requests where user is receiver
    let requests: Vec<FriendRequest> = fr::friend_requests
        .filter(fr::receiver_id.eq(user_id))
        .filter(fr::status.eq("pending"))
        .order(fr::created_at.desc())
        .load(conn)?;

    let sender_ids: Vec<i32> = requests.iter().map(|r| r.sender_id).collect();
    let senders: Vec<User> = u::users.filter(u::id.eq_any(&sender_ids)).load(conn)?;

    let receiver: User = u::users.filter(u::id.eq(user_id)).first(conn)?;

    let result: Vec<FriendRequestResponse> = requests
        .iter()
        .filter_map(|request| {
            let sender = senders.iter().find(|s| s.id == request.sender_id)?.clone();
            Some(FriendRequestResponse::from_request_and_users(
                request,
                sender,
                receiver.clone(),
            ))
        })
        .collect();

    json_ok(result)
}

/// Get outgoing friend requests
#[endpoint]
async fn get_outgoing_requests(
    depot: &mut Depot,
) -> JsonResult<Vec<FriendRequestResponse>> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let session = depot.session();
    let user_id = session.user_id;

    let conn = &mut db::get()?;

    // Get pending requests where user is sender
    let requests: Vec<FriendRequest> = fr::friend_requests
        .filter(fr::sender_id.eq(user_id))
        .filter(fr::status.eq("pending"))
        .order(fr::created_at.desc())
        .load(conn)?;

    let receiver_ids: Vec<i32> = requests.iter().map(|r| r.receiver_id).collect();
    let receivers: Vec<User> = u::users.filter(u::id.eq_any(&receiver_ids)).load(conn)?;

    let sender: User = u::users.filter(u::id.eq(user_id)).first(conn)?;

    let result: Vec<FriendRequestResponse> = requests
        .iter()
        .filter_map(|request| {
            let receiver = receivers
                .iter()
                .find(|r| r.id == request.receiver_id)?
                .clone();
            Some(FriendRequestResponse::from_request_and_users(
                request,
                sender.clone(),
                receiver,
            ))
        })
        .collect();

    json_ok(result)
}
