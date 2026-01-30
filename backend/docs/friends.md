# Friend System

## Overview

Simple friend request system without real-time notifications. Friends are managed through REST API endpoints.

## Endpoints

All endpoints require JWT authentication (`.requires_user_login()`).

| Method | Path                                   | Description                    |
|--------|-------------------------------------   |--------------------------------|
| POST   | `/api/friends/request`                 | Send friend request            |
| DELETE | `/api/friends/request/<request_id>`    | Cancel own pending request     |
| POST   | `/api/friends/accept/<request_id>`     | Accept incoming request        |
| POST   | `/api/friends/reject/<request_id>`     | Reject incoming request        |
| DELETE | `/api/friends/<user_id>`               | Remove a friend                |
| GET    | `/api/friends`                         | List all friends               |
| GET    | `/api/friends/requests/incoming`       | List pending requests received |
| GET    | `/api/friends/requests/outgoing`       | List pending requests sent     |

## Database

Table `friend_requests`:

```sql
CREATE TABLE friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CHECK (sender_id != receiver_id)
);
```

Indexes on `(receiver_id, status)`, `(sender_id, status)`, and `(sender_id, receiver_id)`.

## Design Decisions

### Status handling
- `pending`: Active request awaiting response
- `accepted`: Friendship established (row kept for relationship tracking)
- `rejected`: Not used - rejected requests are deleted

### No notifications
Real-time notifications via WebTransport were considered but deferred. The system is designed to be extended with notifications later if needed.

## Errors

| Error              | HTTP | Cause                                  |
|--------------------|------|----------------------------------------|
| `SelfRequest`      | 400  | Cannot send friend request to yourself |
| `DuplicateRequest` | 400  | Pending request already exists         |
| `AlreadyFriends`   | 400  | Already friends with this user         |
| `RequestNotFound`  | 404  | Request ID does not exist              |
| `NotAuthorized`    | 403  | Not allowed to modify this request     |
| `UserNotFound`     | 404  | Target user does not exist             |
| `NotFriends`       | 404  | Cannot remove - not friends            |
| `InvalidParam`     | 400  | Missing or malformed path parameter    |
