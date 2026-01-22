use std::sync::{Arc, LazyLock};

use chrono::NaiveDateTime;
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use validator::ValidationError;

use crate::models::{ChatMessage, ChatRoom, ChatRoomType, NewChatRoom};
use crate::prelude::*;
use crate::stream::{Receiver, Sender, StreamManager};

mod endpoints;
mod stream;

const MESSAGE_LOG_LIMIT: i64 = 150;
/// User limit per chat room, for public/invite-only rooms
const CHAT_ROOM_USER_LIMIT: usize = 200;
