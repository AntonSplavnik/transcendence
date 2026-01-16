# User Profile - Documentation

## Module Objectives

### Requirements (Major Module)
**Standard user management and authentication:**
- Users can update their profile information
- Users can upload an avatar (with a default avatar if none provided)
- Users can add other users as friends and see their online status
- Users have a profile page displaying their information

---

## Implementation Completed

### 1. Backend - Avatar System

**Architectural Decision:**
- Logical grouping of migrations for better clarity
- Structure actual:
  1. `create_users` - Base user table
  2. `create_sessions` - Session management
  3. `player_stats` - Game statistics (user_stats + game_history)
  4. `profile_features` - Profile features (avatar)

#### Avatar Upload
**Endpoint: `POST /api/profile/avatar`**

**File:** `backend/src/routers/profile.rs`

**Features:**
- Multipart/form-data file upload
- MIME type validation (image/jpeg, image/png, image/gif, image/webp)
- Unique naming: `user_{user_id}_{timestamp}.{ext}`
- Storage: `backend/static/avatars/`
- Save path in DB: `/avatars/filename`

**Key code:**
```rust
let filename = format!("user_{}_{}.{}", user_id, timestamp, ext);
let file_path = avatars_dir.join(&filename);

// Save to database
let avatar_url = format!("/avatars/{}", filename);
diesel::update(users::table.find(user_id))
    .set(users::avatar_url.eq(&avatar_url))
    .execute(&mut conn)?;
```

#### Avatar Serving
**Route: `GET /avatars/{*path}`**

**File:** `backend/src/routers.rs`

**Critical Technical Decision:**
- Use `{*path}` (unnamed wildcard) instead of `<**path>` (named parameter)
- Salvo's `StaticDir` requires an unnamed wildcard to work
- Centralized configuration via `config.avatars_dir`

---

### 2. Frontend - Avatar Component

#### Avatar Component
**File:** `frontend/src/components/Avatar.tsx`

**Features:**
- Display image if `avatar_url` exists
- Fallback to colored initials if no avatar
- Background color generated from nickname hash
- Colored circle with centered white initials

#### ProfileEdit Modal
**File:** `frontend/src/components/ProfileEdit.tsx`

**Features:**
- File input to select an image
- Preview of current avatar
- Upload via `fetch` with `FormData`
- Error handling (file type, size)
- User feedback (loading, success, error)

---

## Next Steps

### To Implement
- [ ] Real-time notifications (WebSocket/SSE)

---

*Documentation updated on January 18, 2025*
