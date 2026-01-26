# Avatar

Avatars allow users to personalize their profile with an image.

## Format: AVIF only

Avatars exclusively use the **AVIF** format for its advantages:
- Superior compression (lighter images than JPEG/PNG)
- Native support in modern browsers

### Frontend-side conversion

AVIF conversion is done **client-side** (browser) to:
- Save server CPU cycles (AVIF encoding is expensive)
- Distribute the workload across user machines


**The backend only validates**:
- File size within limits
- Valid AVIF format (decoded to verify)
- No transparency/alpha channel
- Still image (no animation)

## Two size variants

| Variant   | Dimensions | Max size | Usage                              |
|-----------|------------|----------|------------------------------------|
| **Large** | 450×450 px | 20 KB    | Detailed profile display           |
| **Small** | 200×200 px | 8 KB     | Lists, thumbnails, everywhere else |

Both variants are stored in separate SQLite tables (`avatars_large`, `avatars_small`).

## In-memory cache

**Small avatars** are cached in memory on the backend:
- Capacity: 1000 entries
- Memory usage: ~4 MB (1000 × 4 KB)
- Automatic invalidation on upload or deletion

Large avatars are not cached (less frequent usage).

## API Endpoints

All endpoints require authentication (JWT).

### `POST /api/avatar`

Upload or update avatar.

### `GET /api/avatar/:user_id/large`

Retrieve a user's large avatar.

### `GET /api/avatar/:user_id/small`

Retrieve a user's small avatar. **Uses cache.**

### `DELETE /api/avatar`

Delete the authenticated user's avatar (both variants).


## Storage

Avatars are stored directly in SQLite (BLOB) for:
- Transactional consistency with other user data
- Simplicity (no external service like S3/MinIO)
- Acceptable for images < 20 KB and a moderate user base
