//! Real-time notifications via WebTransport.
//!
//! This module provides functions to send notifications to connected users
//! for friend-related events.

use futures::SinkExt as _;
use serde::{Deserialize, Serialize};

use super::{StreamManager, StreamType};
use crate::routers::users::PublicUser;

/// Notification types sent to users via WebTransport.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum FriendNotification {
    /// A user received a new friend request
    FriendRequestReceived {
        request_id: i32,
        from_user: PublicUser,
    },
    /// A friend request was accepted
    FriendRequestAccepted { by_user: PublicUser },
    /// A friend came online
    FriendOnline { user_id: i32 },
    /// A friend went offline
    FriendOffline { user_id: i32 },
}

/// Send a friend request received notification.
pub async fn notify_friend_request_received(
    receiver_id: i32,
    request_id: i32,
    from_user: PublicUser,
) {
    let notification = FriendNotification::FriendRequestReceived {
        request_id,
        from_user,
    };
    send_notification(receiver_id, notification).await;
}

/// Send a friend request accepted notification.
pub async fn notify_friend_request_accepted(sender_id: i32, by_user: PublicUser) {
    let notification = FriendNotification::FriendRequestAccepted { by_user };
    send_notification(sender_id, notification).await;
}

/// Notify all friends that a user came online.
pub async fn notify_friends_user_online(user_id: i32) {
    let friend_ids = get_friend_ids(user_id);
    let notification = FriendNotification::FriendOnline { user_id };

    for friend_id in friend_ids {
        send_notification(friend_id, notification.clone()).await;
    }
}

/// Notify all friends that a user went offline.
pub async fn notify_friends_user_offline(user_id: i32) {
    let friend_ids = get_friend_ids(user_id);
    let notification = FriendNotification::FriendOffline { user_id };

    for friend_id in friend_ids {
        send_notification(friend_id, notification.clone()).await;
    }
}

/// Send a notification to a user if they are connected.
async fn send_notification(user_id: i32, notification: FriendNotification) {
    let manager = StreamManager::global();

    if !manager.is_connected(user_id) {
        return;
    }

    let result = manager
        .request_stream::<FriendNotification, ()>(
            user_id,
            StreamType::FriendNotification,
        )
        .await;

    match result {
        Ok((mut sender, _receiver)) => {
            if let Err(e) = sender.send(notification).await {
                tracing::warn!(
                    user_id,
                    error = %e,
                    "Failed to send friend notification"
                );
            }
        }
        Err(e) => {
            tracing::debug!(
                user_id,
                error = %e,
                "Could not open stream for friend notification"
            );
        }
    }
}

/// Get the list of friend IDs for a user.
fn get_friend_ids(user_id: i32) -> Vec<i32> {
    use crate::prelude::*;
    use crate::schema::friend_requests::dsl as fr;

    let conn = match crate::db::get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            return vec![];
        }
    };
    let mut conn = conn;

    let friendships: Vec<crate::models::FriendRequest> = match fr::friend_requests
        .filter(fr::status.eq("accepted"))
        .filter(
            fr::sender_id
                .eq(user_id)
                .or(fr::receiver_id.eq(user_id)),
        )
        .load(&mut conn)
    {
        Ok(f) => f,
        Err(e) => {
            tracing::error!(error = %e, "Failed to load friendships");
            return vec![];
        }
    };

    friendships
        .iter()
        .map(|f| {
            if f.sender_id == user_id {
                f.receiver_id
            } else {
                f.sender_id
            }
        })
        .collect()
}
