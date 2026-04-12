# Friend System

## Overview

Friends are managed through REST API endpoints. Friend lifecycle actions emit events through the existing notification system (e.g. `FriendRequestReceived`, `FriendRequestAccepted`), following the standard notification delivery mechanisms used elsewhere in the application.

## Endpoints

All endpoints require JWT authentication (`.requires_user_login()`) and are rate-limited.

| Method | Path                                    | Rate limit | Description                    |
|--------|-----------------------------------------|------------|--------------------------------|
| POST   | `/api/friends/request`                  | 30/min     | Send friend request            |
| DELETE | `/api/friends/request/{request_id}`     | 30/min     | Cancel own pending request     |
| POST   | `/api/friends/accept/{request_id}`      | 30/min     | Accept incoming request        |
| POST   | `/api/friends/reject/{request_id}`      | 30/min     | Reject incoming request        |
| DELETE | `/api/friends/remove/{user_id}`         | 30/min     | Remove a friend                |
| GET    | `/api/friends`                          | 60/min     | List all friends               |
| GET    | `/api/friends/requests/incoming`        | 60/min     | List pending requests received |
| GET    | `/api/friends/requests/outgoing`        | 60/min     | List pending requests sent     |

## Database

Table `friend_requests`:

```sql
CREATE TABLE friend_requests (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1)),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (sender_id != receiver_id)
);

CREATE INDEX idx_friend_requests_receiver_status ON friend_requests(receiver_id, status);
CREATE INDEX idx_friend_requests_sender_status ON friend_requests(sender_id, status);
CREATE UNIQUE INDEX idx_friend_requests_unique_pair
    ON friend_requests(MIN(sender_id, receiver_id), MAX(sender_id, receiver_id));
```

`status` is an INTEGER-backed enum mapped in Rust via `diesel_i32_enum!`. JSON API responses serialize the values as lowercase strings.

## Design Decisions

### Status handling
- `0` / `"pending"`: Active request awaiting response
- `1` / `"accepted"`: Friendship established (row kept for relationship tracking)

### Notifications
Each action sends a notification to the other user via `NotificationManager`:

| Action  | Notification                | Target   |
|---------|-----------------------------|----------|
| Send    | `FriendRequestReceived`     | Receiver |
| Accept  | `FriendRequestAccepted`     | Sender   |
| Reject  | `FriendRequestRejected`     | Sender   |
| Cancel  | `FriendRequestCancelled`    | Receiver |
| Remove  | `FriendRemoved`             | Friend   |

Notifications are delivered in real-time via WebTransport if the target has an open stream, otherwise stored in the `notifications` table as CBOR blobs and drained on reconnect.

### Safety
- All mutations use atomic WHERE clauses (re-check `status = 0`) to prevent race conditions
- Spam protection: max 50 pending outgoing requests per user
- Unique index using `MIN/MAX` prevents duplicate pairs in either direction

## Errors

Errors use `strum::IntoStaticStr` to send variant names as briefs.

| Error              | HTTP | Cause                                  |
|--------------------|------|----------------------------------------|
| `SelfRequest`      | 400  | Cannot send friend request to yourself |
| `DuplicateRequest` | 400  | Pending request already exists         |
| `AlreadyFriends`   | 400  | Already friends with this user         |
| `TooManyPending`   | 400  | Too many pending outgoing requests     |
| `InvalidParam`     | 400  | Missing or malformed request parameter |
| `RequestNotFound`  | 404  | Request ID does not exist              |
| `UserNotFound`     | 404  | Target user does not exist             |
| `NotFriends`       | 404  | Cannot remove — not friends            |
| `NotAuthorized`    | 403  | Not allowed to modify this request     |
| `RequestNotPending`| 409  | Request was already processed          |
