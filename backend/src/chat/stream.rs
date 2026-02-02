use std::sync::LazyLock;

use parking_lot::Mutex;
use schnellru::{ByLength, LruMap};

use crate::{
    models::{ChatMember, ChatMessage, ChatRoomType},
    prelude::*,
};

const GLOBAL_MESSAGE_CHARS_LIMIT: usize = 512;
const OTHER_MESSAGE_CHARS_LIMIT: usize = 4096;
const SENDMESSAGE_RATE_LIMIT_PER_5_SECONDS: usize = 6;
const NICKNAME_CACHE_SIZE: u32 = 8192;
// TODO dont forget to limit chatroom invitations to CHAT_ROOM_USER_LIMIT - member_count
// TODO regular task to automatically remove pending invitations if they are older than for example 14 days
// an event with actor_id = user_id must be emitted (user either rejected the invitation, or let it time out)

/// TODO: global user nickname cache
fn get_nickname(user_id: i32) -> Option<String> {
    static LRU: LazyLock<
        Mutex<LruMap<i32, String, ByLength, ahash::RandomState>>,
    > = LazyLock::new(|| {
        Mutex::new(LruMap::with_hasher(
            ByLength::new(NICKNAME_CACHE_SIZE),
            Default::default(),
        ))
    });
    let nick = { LRU.lock().get(&user_id).cloned() };
    nick.or_else(|| {
        use crate::schema::users::dsl::*;
        let conn = &mut db::get().ok()?;
        match users
            .filter(id.eq(user_id))
            .select(nickname)
            .first::<String>(conn)
            .optional()
            .ok()?
        {
            Some(nick) => {
                LRU.lock().insert(user_id, nick.clone());
                Some(nick)
            }
            None => None,
        }
    })
}

/// Sent in response to client actions when an error occurs
#[derive(Debug, Serialize, Clone, Copy)]
enum ChatStreamError {
    /// Client sent a message that was dropped due to rate limiting
    RateLimitExceeded,
    /// Client sent a message that was too long
    MessageTooLong,
    /// Client tried to reference an invalid message ID
    InvalidMessageId,
    /// Client tried to set ReadText pointer to a message older than current pointer
    CantUnreadText,
}

/// Only a subset of client actions are sent over the stream; others (infrequent ones) are done via REST API
#[derive(Debug, Deserialize, Clone)]
enum ClientMessage {
    /// Client will receive its own message as NewMsg, or an error if it failed
    SendText(String),
    /// Not sent for global room
    IsTyping,
    /// Not sent for global room
    ReadText(i32),
}

#[derive(Debug, Serialize, Clone)]
enum ServerMessage {
    /// Client needs to update the chat room name
    ChatName(String),
    /// Client needs to update the chat room type
    ChatType(ChatRoomType),
    /// Client needs to update user nicknames
    /// global: sent before MsgLog
    /// others: sent before Members
    Nicks(Vec<(i32, String)>),
    /// Client needs to update a single user nickname
    /// global: sent before NewMsg
    /// others: sent before MemberAdded
    Nick { user_id: i32, nickname: String },
    /// Client needs to update the entire message log
    /// global: sent after Nicks
    /// others: sent after Members
    MsgLog(Vec<ChatMessage>),
    /// Client needs to add a new message to their log
    NewMsg(ChatMessage),
    /// Client needs to display a typing indicator for the user for a few seconds
    /// global: omitted
    IsTyping(i32),
    /// Client needs to mark all messages up to message_id as read for the user
    /// global, public, invite_only: omitted
    ReadText { user_id: i32, message_id: i32 },
    /// Client needs to update the entire list of members
    /// Client may show a join message for the joined_at timestamp
    /// global: omitted
    Members {
        members: Vec<ChatMember>,
        online: Vec<i32>,
    },
    /// Client needs to update the member (and maybe show a message?)
    /// global: omitted
    MemberConnected(i32),
    /// Client needs to update the member (and maybe show a message?)
    /// global: omitted
    MemberDisconnected(i32),
    /// Client needs to show that a user has joined the room
    /// global: omitted
    MemberAdded(ChatMember),
    /// Client needs to show that a user has left the room
    /// global: omitted
    MemberRemoved { user_id: i32, actor_id: i32 },
    /// Client needs to show that the user was made an admin
    /// global: omitted
    AdminPromotion { user_id: i32, actor_id: i32 },
    /// Client needs to show that the user was demoted from admin
    /// global: omitted
    AdminDemotion { user_id: i32, actor_id: i32 },
    /// Client needs to show that a join filter was added, type of filter is inferred by room type
    /// global: omitted
    /// others: sent after Nick
    UserInviteAdded { user_id: i32, actor_id: i32 },
    /// Client needs to show that a join filter was removed, type of filter is inferred by room type
    /// global: omitted
    /// others: sent after Nick
    UserInviteRemoved { user_id: i32, actor_id: i32 },
    /// An error occurred
    Error(ChatStreamError),
}
