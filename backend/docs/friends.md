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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CHECK (sender_id != receiver_id)
);
```

## Design Decisions

### Status handling
- `pending`: Active request awaiting response
- `accepted`: Friendship established (row kept for relationship tracking)

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
- All mutations use atomic WHERE clauses (re-check `status = 'pending'`) to prevent race conditions
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
| `InvalidParam`     | 400  | Missing or malformed path parameter    |
| `RequestNotFound`  | 404  | Request ID does not exist              |
| `UserNotFound`     | 404  | Target user does not exist             |
| `NotFriends`       | 404  | Cannot remove — not friends            |
| `NotAuthorized`    | 403  | Not allowed to modify this request     |
| `RequestNotPending`| 409  | Request was already processed          |
