//! GET /api/friends - Get list of friends

use crate::models::{FriendRequest, User};
use crate::prelude::*;
use crate::routers::users::PublicUser;

use super::types::{MAX_LIST_RESULTS, RequestStatus};

/// Get list of friends
#[endpoint]
pub async fn get_friends(depot: &mut Depot, db: Db) -> JsonResult<Vec<PublicUser>> {
    use crate::schema::friend_requests::dsl as fr;
    use crate::schema::users::dsl as u;

    let user_id = depot.session().user_id;

    let result = db
        .read(move |conn| {
            // Get all accepted friend requests where user is either sender or receiver
            let friendships: Vec<FriendRequest> = fr::friend_requests
                .filter(fr::status.eq(RequestStatus::ACCEPTED))
                .filter(fr::sender_id.eq(user_id).or(fr::receiver_id.eq(user_id)))
                .limit(MAX_LIST_RESULTS)
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

            // Load friend users, ordered by nickname
            let friends: Vec<User> = u::users
                .filter(u::id.eq_any(&friend_ids))
                .order(u::nickname.asc())
                .load(conn)?;

            Ok::<_, ApiError>(friends.into_iter().map(PublicUser::from).collect())
        })
        .await??;

    json_ok(result)
}
