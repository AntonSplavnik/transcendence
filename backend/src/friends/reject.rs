//! POST /api/friends/reject/<request_id> - Reject a friend request

use crate::prelude::*;

use super::types::{find_pending_request, parse_param};

/// Reject a friend request
#[endpoint]
pub async fn reject_friend_request(depot: &mut Depot, req: &mut Request, db: Db) -> JsonResult<()> {
    use crate::schema::friend_requests::dsl as fr;

    let user_id = depot.session().user_id;
    let request_id: i32 = parse_param(req, "request_id")?;

    db.write(move |conn| {
        let request = find_pending_request(conn, request_id, user_id, false)?;

        // Delete the request
        diesel::delete(fr::friend_requests.filter(fr::id.eq(request.id))).execute(conn)?;

        Ok::<_, ApiError>(())
    })
    .await??;

    json_ok(())
}
