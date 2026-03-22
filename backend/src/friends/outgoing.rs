//! GET /api/friends/requests/outgoing - Get outgoing friend requests

use crate::prelude::*;

use super::types::{FriendRequestResponse, RequestDirection, load_pending_requests};

/// Get outgoing friend requests
#[endpoint]
pub async fn get_outgoing_requests(
    depot: &mut Depot,
    db: Db,
) -> JsonResult<Vec<FriendRequestResponse>> {
    let user_id = depot.session().user_id;
    let sm = depot.stream_manager().clone();

    let result = db
        .read(move |conn| load_pending_requests(conn, user_id, RequestDirection::Outgoing, &sm))
        .await??;

    json_ok(result)
}
