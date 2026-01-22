mod endpoints;
mod stream;

const MESSAGE_LOG_LIMIT: i64 = 150;
/// User limit per chat room, for public/invite-only rooms
const CHAT_ROOM_USER_LIMIT: usize = 200;
