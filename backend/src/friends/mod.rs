//! Friend system module.
//!
//! Provides endpoints for managing friend requests and friend lists.

mod accept;
mod cancel;
mod incoming;
mod list;
mod outgoing;
mod reject;
mod remove;
mod send;
pub(crate) mod types;

use crate::prelude::*;

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("friends")
        .requires_user_login()
        .push(
            Router::with_path("request")
                .user_rate_limit(&RateLimit::per_minute(30))
                .post(send::send_friend_request)
                .push(
                    Router::with_path("{request_id}")
                        .user_rate_limit(&RateLimit::per_minute(30))
                        .delete(cancel::cancel_friend_request),
                ),
        )
        .push(
            Router::with_path("accept/{request_id}")
                .user_rate_limit(&RateLimit::per_minute(30))
                .post(accept::accept_friend_request),
        )
        .push(
            Router::with_path("reject/{request_id}")
                .user_rate_limit(&RateLimit::per_minute(30))
                .post(reject::reject_friend_request),
        )
        .push(
            Router::with_path("{user_id}")
                .user_rate_limit(&RateLimit::per_minute(30))
                .delete(remove::remove_friend),
        )
        .push(
            Router::new()
                .user_rate_limit(&RateLimit::per_minute(60))
                .get(list::get_friends),
        )
        .push(
            Router::with_path("requests/incoming")
                .user_rate_limit(&RateLimit::per_minute(60))
                .get(incoming::get_incoming_requests),
        )
        .push(
            Router::with_path("requests/outgoing")
                .user_rate_limit(&RateLimit::per_minute(60))
                .get(outgoing::get_outgoing_requests),
        )
}
