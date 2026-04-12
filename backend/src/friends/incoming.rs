//! GET /api/friends/requests/incoming - Get incoming friend requests

use crate::prelude::*;

use super::types::{FriendRequestResponse, RequestDirection, load_pending_requests};

/// Get incoming friend requests
#[endpoint]
pub async fn get_incoming_requests(
    depot: &mut Depot,
    db: Db,
) -> JsonResult<Vec<FriendRequestResponse>> {
    let user_id = depot.session().user_id;
    let sm = depot.stream_manager().clone();

    let result = db
        .read(move |conn| load_pending_requests(conn, user_id, &RequestDirection::Incoming, &sm))
        .await??;

    json_ok(result)
}
