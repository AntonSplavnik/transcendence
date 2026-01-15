use salvo::prelude::*;
use serde::{Serialize, Deserialize};
use diesel::prelude::*;

use crate::prelude::*;
use crate::schema::{friendships, users};
use crate::models::{Friendship, NewFriendship, UpdateFriendship, User};

// ===== SEND FRIEND REQUEST =====

#[derive(Deserialize, ToSchema)]
pub struct SendFriendRequestInput {
    pub to_user_id: i32,
}

#[derive(Serialize, ToSchema)]
pub struct SendFriendRequestResponse {
    pub success: bool,
    pub friendship_id: i32,
}

/// Send a friend request to another user
#[endpoint(
    tags("friends"),
    responses(
        (status_code = 200, description = "Friend request sent successfully", body = SendFriendRequestResponse),
        (status_code = 400, description = "Bad request - Cannot send request to yourself or already exists"),
        (status_code = 401, description = "Unauthorized - User not authenticated"),
        (status_code = 404, description = "User not found"),
        (status_code = 500, description = "Internal server error"),
    )
)]
pub async fn send_friend_request(
    json: JsonBody<SendFriendRequestInput>,
    depot: &mut Depot,
) -> Result<Json<SendFriendRequestResponse>, StatusError> {
    let from_user_id = depot.user_id();
    let input = json.into_inner();
    
    // Validate: cannot send request to yourself
    if from_user_id == input.to_user_id {
        return Err(StatusError::bad_request().brief("Cannot send friend request to yourself"));
    }

    let mut conn = crate::db::get()
        .map_err(|e| {
            tracing::error!("Database connection error: {}", e);
            StatusError::internal_server_error().brief("Database connection failed")
        })?;

    // Check if target user exists
    let target_user_exists = users::table
        .find(input.to_user_id)
        .select(users::id)
        .first::<i32>(&mut conn)
        .optional()
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to query user")
        })?;

    if target_user_exists.is_none() {
        return Err(StatusError::not_found().brief("User not found"));
    }

    // Check if friendship already exists (in either direction)
    let existing_friendship = friendships::table
        .filter(
            friendships::from_user_id.eq(from_user_id)
                .and(friendships::to_user_id.eq(input.to_user_id))
                .or(
                    friendships::from_user_id.eq(input.to_user_id)
                        .and(friendships::to_user_id.eq(from_user_id))
                )
        )
        .first::<Friendship>(&mut conn)
        .optional()
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to query friendships")
        })?;

    if let Some(existing) = existing_friendship {
        match existing.status.as_str() {
            "pending" => {
                // If the other user already sent a request, auto-accept both
                if existing.from_user_id == input.to_user_id {
                    let now = chrono::Utc::now().naive_utc();
                    diesel::update(friendships::table.find(existing.id))
                        .set(UpdateFriendship {
                            status: Some("accepted".to_string()),
                            updated_at: now,
                        })
                        .execute(&mut conn)
                        .map_err(|e| {
                            tracing::error!("Failed to update friendship: {}", e);
                            StatusError::internal_server_error().brief("Failed to update friendship")
                        })?;

                    return Ok(Json(SendFriendRequestResponse {
                        success: true,
                        friendship_id: existing.id,
                    }));
                } else {
                    return Err(StatusError::bad_request().brief("Friend request already sent"));
                }
            }
            "accepted" => {
                return Err(StatusError::bad_request().brief("Already friends"));
            }
            "blocked" => {
                return Err(StatusError::bad_request().brief("Cannot send friend request"));
            }
            _ => {}
        }
    }

    // Create new friend request
    let now = chrono::Utc::now().naive_utc();
    let new_friendship = NewFriendship {
        from_user_id,
        to_user_id: input.to_user_id,
        status: "pending".to_string(),
        created_at: now,
        updated_at: now,
    };

    let friendship: Friendship = diesel::insert_into(friendships::table)
        .values(&new_friendship)
        .get_result(&mut conn)
        .map_err(|e| {
            tracing::error!("Failed to create friendship: {}", e);
            StatusError::internal_server_error().brief("Failed to send friend request")
        })?;

    Ok(Json(SendFriendRequestResponse {
        success: true,
        friendship_id: friendship.id,
    }))
}

// ===== GET FRIEND REQUESTS =====

#[derive(Serialize, ToSchema)]
pub struct FriendRequestItem {
    pub id: i32,
    pub from_user_id: i32,
    pub from_nickname: String,
    pub from_avatar_url: Option<String>,
    pub created_at: String,
}

/// Get pending friend requests received by the current user
#[endpoint(
    tags("friends"),
    responses(
        (status_code = 200, description = "Friend requests retrieved successfully", body = Vec<FriendRequestItem>),
        (status_code = 401, description = "Unauthorized - User not authenticated"),
        (status_code = 500, description = "Internal server error"),
    )
)]
pub async fn get_friend_requests(depot: &mut Depot) -> Result<Json<Vec<FriendRequestItem>>, StatusError> {
    let user_id = depot.user_id();
    
    let mut conn = crate::db::get()
        .map_err(|e| {
            tracing::error!("Database connection error: {}", e);
            StatusError::internal_server_error().brief("Database connection failed")
        })?;

    let requests: Vec<(Friendship, User)> = friendships::table
        .inner_join(users::table.on(friendships::from_user_id.eq(users::id)))
        .filter(friendships::to_user_id.eq(user_id))
        .filter(friendships::status.eq("pending"))
        .order(friendships::created_at.desc())
        .select((Friendship::as_select(), User::as_select()))
        .load(&mut conn)
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to query friend requests")
        })?;

    let response: Vec<FriendRequestItem> = requests
        .into_iter()
        .map(|(friendship, user)| FriendRequestItem {
            id: friendship.id,
            from_user_id: user.id,
            from_nickname: user.nickname,
            from_avatar_url: user.avatar_url,
            created_at: friendship.created_at.format("%Y-%m-%d %H:%M").to_string(),
        })
        .collect();

    Ok(Json(response))
}

// ===== ACCEPT FRIEND REQUEST =====

#[derive(Serialize, ToSchema)]
pub struct AcceptFriendResponse {
    pub success: bool,
}

/// Accept a pending friend request
#[endpoint(
    tags("friends"),
    parameters(
        ("id" = i32, Path, description = "Friendship ID")
    ),
    responses(
        (status_code = 200, description = "Friend request accepted", body = AcceptFriendResponse),
        (status_code = 401, description = "Unauthorized - User not authenticated"),
        (status_code = 404, description = "Friend request not found"),
        (status_code = 500, description = "Internal server error"),
    )
)]
pub async fn accept_friend_request(
    req: &mut Request,
    depot: &mut Depot,
) -> Result<Json<AcceptFriendResponse>, StatusError> {
    let user_id = depot.user_id();
    let friendship_id: i32 = req.param::<String>("id")
        .ok_or_else(|| StatusError::bad_request().brief("Missing friendship ID"))?
        .parse()
        .map_err(|_| StatusError::bad_request().brief("Invalid friendship ID"))?;
    
    let mut conn = crate::db::get()
        .map_err(|e| {
            tracing::error!("Database connection error: {}", e);
            StatusError::internal_server_error().brief("Database connection failed")
        })?;

    // Verify the request is addressed to the current user
    let friendship = friendships::table
        .find(friendship_id)
        .filter(friendships::to_user_id.eq(user_id))
        .filter(friendships::status.eq("pending"))
        .first::<Friendship>(&mut conn)
        .optional()
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to query friendship")
        })?;

    if friendship.is_none() {
        return Err(StatusError::not_found().brief("Friend request not found"));
    }

    // Accept the request
    let now = chrono::Utc::now().naive_utc();
    diesel::update(friendships::table.find(friendship_id))
        .set(UpdateFriendship {
            status: Some("accepted".to_string()),
            updated_at: now,
        })
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("Failed to update friendship: {}", e);
            StatusError::internal_server_error().brief("Failed to accept friend request")
        })?;

    Ok(Json(AcceptFriendResponse { success: true }))
}

// ===== DECLINE FRIEND REQUEST =====

/// Decline a pending friend request
#[endpoint(
    tags("friends"),
    parameters(
        ("id" = i32, Path, description = "Friendship ID")
    ),
    responses(
        (status_code = 200, description = "Friend request declined", body = AcceptFriendResponse),
        (status_code = 401, description = "Unauthorized - User not authenticated"),
        (status_code = 404, description = "Friend request not found"),
        (status_code = 500, description = "Internal server error"),
    )
)]
pub async fn decline_friend_request(
    req: &mut Request,
    depot: &mut Depot,
) -> Result<Json<AcceptFriendResponse>, StatusError> {
    let user_id = depot.user_id();
    let friendship_id: i32 = req.param::<String>("id")
        .ok_or_else(|| StatusError::bad_request().brief("Missing friendship ID"))?
        .parse()
        .map_err(|_| StatusError::bad_request().brief("Invalid friendship ID"))?;
    
    let mut conn = crate::db::get()
        .map_err(|e| {
            tracing::error!("Database connection error: {}", e);
            StatusError::internal_server_error().brief("Database connection failed")
        })?;

    // Verify the request is addressed to the current user
    let friendship = friendships::table
        .find(friendship_id)
        .filter(friendships::to_user_id.eq(user_id))
        .filter(friendships::status.eq("pending"))
        .first::<Friendship>(&mut conn)
        .optional()
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to query friendship")
        })?;

    if friendship.is_none() {
        return Err(StatusError::not_found().brief("Friend request not found"));
    }

    // Decline the request (could also delete it)
    let now = chrono::Utc::now().naive_utc();
    diesel::update(friendships::table.find(friendship_id))
        .set(UpdateFriendship {
            status: Some("declined".to_string()),
            updated_at: now,
        })
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("Failed to update friendship: {}", e);
            StatusError::internal_server_error().brief("Failed to decline friend request")
        })?;

    Ok(Json(AcceptFriendResponse { success: true }))
}

// ===== REMOVE FRIEND =====

/// Remove a friend (delete friendship)
#[endpoint(
    tags("friends"),
    responses(
        (status_code = 200, description = "Friend removed successfully", body = AcceptFriendResponse),
        (status_code = 401, description = "Unauthorized - User not authenticated"),
        (status_code = 404, description = "Friendship not found"),
        (status_code = 500, description = "Internal server error"),
    )
)]
pub async fn remove_friend(
    req: &mut Request,
    depot: &mut Depot,
) -> Result<Json<AcceptFriendResponse>, StatusError> {
    let user_id = depot.user_id();
    let friend_user_id: i32 = req.param::<String>("id")
        .ok_or_else(|| StatusError::bad_request().brief("Missing user ID"))?
        .parse()
        .map_err(|_| StatusError::bad_request().brief("Invalid user ID"))?;
    
    let mut conn = crate::db::get()
        .map_err(|e| {
            tracing::error!("Database connection error: {}", e);
            StatusError::internal_server_error().brief("Database connection failed")
        })?;

    // Find friendship in either direction
    let deleted = diesel::delete(
        friendships::table.filter(
            friendships::from_user_id.eq(user_id)
                .and(friendships::to_user_id.eq(friend_user_id))
                .and(friendships::status.eq("accepted"))
                .or(
                    friendships::from_user_id.eq(friend_user_id)
                        .and(friendships::to_user_id.eq(user_id))
                        .and(friendships::status.eq("accepted"))
                )
        )
    )
    .execute(&mut conn)
    .map_err(|e| {
        tracing::error!("Failed to delete friendship: {}", e);
        StatusError::internal_server_error().brief("Failed to remove friend")
    })?;

    if deleted == 0 {
        return Err(StatusError::not_found().brief("Friendship not found"));
    }

    Ok(Json(AcceptFriendResponse { success: true }))
}

// ===== GET FRIENDS LIST =====

#[derive(Serialize, ToSchema)]
pub struct FriendItem {
    pub id: i32,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub is_online: bool,
    pub last_seen: Option<String>,
}

/// Get list of all friends (accepted friendships) with their online status
#[endpoint(
    tags("friends"),
    responses(
        (status_code = 200, description = "Friends list retrieved successfully", body = Vec<FriendItem>),
        (status_code = 401, description = "Unauthorized - User not authenticated"),
        (status_code = 500, description = "Internal server error"),
    )
)]
pub async fn get_friends_list(depot: &mut Depot) -> Result<Json<Vec<FriendItem>>, StatusError> {
    let user_id = depot.user_id();
    
    let mut conn = crate::db::get()
        .map_err(|e| {
            tracing::error!("Database connection error: {}", e);
            StatusError::internal_server_error().brief("Database connection failed")
        })?;

    // Get friends where current user is either from_user or to_user
    let friendships_from: Vec<(Friendship, User)> = friendships::table
        .inner_join(users::table.on(friendships::to_user_id.eq(users::id)))
        .filter(friendships::from_user_id.eq(user_id))
        .filter(friendships::status.eq("accepted"))
        .select((Friendship::as_select(), User::as_select()))
        .load(&mut conn)
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to query friends")
        })?;

    let friendships_to: Vec<(Friendship, User)> = friendships::table
        .inner_join(users::table.on(friendships::from_user_id.eq(users::id)))
        .filter(friendships::to_user_id.eq(user_id))
        .filter(friendships::status.eq("accepted"))
        .select((Friendship::as_select(), User::as_select()))
        .load(&mut conn)
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to query friends")
        })?;

    let mut friends: Vec<FriendItem> = Vec::new();

    for (_, user) in friendships_from {
        friends.push(FriendItem {
            id: user.id,
            nickname: user.nickname,
            avatar_url: user.avatar_url,
            is_online: user.is_online,
            last_seen: user.last_seen.map(|dt| dt.format("%Y-%m-%d %H:%M").to_string()),
        });
    }

    for (_, user) in friendships_to {
        friends.push(FriendItem {
            id: user.id,
            nickname: user.nickname,
            avatar_url: user.avatar_url,
            is_online: user.is_online,
            last_seen: user.last_seen.map(|dt| dt.format("%Y-%m-%d %H:%M").to_string()),
        });
    }

    // Sort by online status then by nickname
    friends.sort_by(|a, b| {
        match (a.is_online, b.is_online) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.nickname.cmp(&b.nickname),
        }
    });

    Ok(Json(friends))
}

// ===== SEARCH USERS =====

#[derive(Serialize, ToSchema)]
pub struct UserSearchResult {
    pub id: i32,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub friendship_status: Option<String>, // null if not friends, "pending", "accepted", etc.
}

/// Search users by nickname (for adding friends)
#[endpoint(
    tags("friends"),
    responses(
        (status_code = 200, description = "Search results", body = Vec<UserSearchResult>),
        (status_code = 401, description = "Unauthorized - User not authenticated"),
        (status_code = 500, description = "Internal server error"),
    )
)]
pub async fn search_users(
    req: &mut Request,
    depot: &mut Depot,
) -> Result<Json<Vec<UserSearchResult>>, StatusError> {
    let user_id = depot.user_id();
    let query = req.query::<String>("q")
        .ok_or_else(|| StatusError::bad_request().brief("Missing search query"))?;
    
    if query.len() < 2 {
        return Err(StatusError::bad_request().brief("Search query must be at least 2 characters"));
    }

    let mut conn = crate::db::get()
        .map_err(|e| {
            tracing::error!("Database connection error: {}", e);
            StatusError::internal_server_error().brief("Database connection failed")
        })?;

    // Search users by nickname (case-insensitive)
    let search_pattern = format!("%{}%", query.to_lowercase());
    let found_users: Vec<User> = users::table
        .filter(users::nickname.like(&search_pattern))
        .filter(users::id.ne(user_id)) // Exclude self
        .limit(20)
        .load(&mut conn)
        .map_err(|e| {
            tracing::error!("Database query error: {}", e);
            StatusError::internal_server_error().brief("Failed to search users")
        })?;

    // Get friendship status for each user
    let mut results: Vec<UserSearchResult> = Vec::new();

    for user in found_users {
        // Check if there's a friendship
        let friendship = friendships::table
            .filter(
                friendships::from_user_id.eq(user_id)
                    .and(friendships::to_user_id.eq(user.id))
                    .or(
                        friendships::from_user_id.eq(user.id)
                            .and(friendships::to_user_id.eq(user_id))
                    )
            )
            .first::<Friendship>(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("Database query error: {}", e);
                StatusError::internal_server_error().brief("Failed to query friendships")
            })?;

        results.push(UserSearchResult {
            id: user.id,
            nickname: user.nickname,
            avatar_url: user.avatar_url,
            friendship_status: friendship.map(|f| f.status),
        });
    }

    Ok(Json(results))
}

// ===== ROUTER =====

pub fn router(path: impl Into<String>) -> Router {
    Router::with_path(path.into())
        .requires_user_login()
        .push(Router::with_path("request").post(send_friend_request))
        .push(Router::with_path("requests").get(get_friend_requests))
        .push(Router::with_path("accept/{id}").post(accept_friend_request))
        .push(Router::with_path("decline/{id}").post(decline_friend_request))
        .push(Router::with_path("remove/{id}").delete(remove_friend))
        .push(Router::with_path("list").get(get_friends_list))
        .push(Router::with_path("search").get(search_users))
}

