# Avatar System (Backend)

Scope:

- Backend crate under `backend/`
- Avatar upload, storage, and retrieval for user profile images

## High-level architecture

The avatar system stores user profile images in two sizes:

1. **Large avatar** (450x450 pixels, max 30KB)
   - Used for profile pages and detailed views
   - Stored in `avatars_large` table

2. **Small avatar** (200x200 pixels, max 12KB)
   - Used for lists, chat, game UI
   - Stored in `avatars_small` table
   - Cached in memory for fast retrieval

Both images must be provided by the client in AVIF format. A default avatar is served for users without a custom avatar.

## Source-of-truth in code

Core modules:

- `backend/src/avatar/mod.rs`: module exports
- `backend/src/avatar/router.rs`: API endpoints (upload, get, delete)
- `backend/src/avatar/validate.rs`: AVIF validation logic
- `backend/src/avatar/cache.rs`: in-memory cache for small avatars

Assets:

- `backend/assets/default_avatar_large.avif`: default large avatar (450x450)
- `backend/assets/default_avatar_small.avif`: default small avatar (200x200)

Database schema:

- `backend/migrations/2025-12-28-213953-0000_create_avatars/up.sql`

## Image format and validation

### Why AVIF?

- Superior compression (~30-50% smaller than JPEG at same quality)
- Modern format with wide browser support
- No patent issues

### Validation rules

All uploaded images must pass:

1. **File size limits**
   - Large: max 30KB
   - Small: max 12KB

2. **Exact dimensions**
   - Large: exactly 450x450 pixels
   - Small: exactly 200x200 pixels

3. **Format verification**
   - AVIF magic bytes check (ftyp box with avif/avis/mif1 brand)
   - Full decode to verify integrity

4. **No transparency**
   - Alpha channel is rejected
   - Ensures consistent rendering on all backgrounds

5. **No animation**
   - Still images only

### Why client-side conversion?

The backend does NOT convert images. Reasons:

- CPU intensive operation offloaded to client
- User can preview exact result before upload
- Reduces server attack surface (no image processing vulnerabilities)

The frontend is responsible for:
- Cropping to square
- Resizing to both dimensions
- Converting to AVIF
- Stripping alpha channel

## Caching strategy

### In-memory cache (server-side)

Small avatars are cached using `quick_cache`:

- **Capacity**: 1000 entries (~4MB max)
- **Eviction**: LRU (least recently used)
- **Invalidation**: on upload and delete

The cache is NOT used for:
- Large avatars (less frequently accessed)
- Default avatars (already in memory via `include_bytes!`)

### Design decision: Cache duration trade-offs

**Problem**: When User A changes their avatar, User B (viewing User A's profile) may still see the old avatar until their browser cache expires.

**Considered options**:

| Option | Pros | Cons |
|--------|------|------|
| `max-age=3600` (1h) | Fewer requests, good perf | Stale avatars for up to 1h |
| `max-age=300` (5min) | Faster propagation | 12x more requests |
| `max-age=60` (1min) | Near realtime | 60x more requests |
| ETag + conditional GET | Bandwidth efficient | More complexity |
| WebSocket notifications | Realtime updates | Overkill for avatars |

**Chosen approach**: `max-age=3600` (1 hour)

Rationale:
- Avatar changes are infrequent events
- 1 hour delay is acceptable UX for a game
- Small images (4-14KB) make bandwidth less critical
- Server-side memory cache handles repeated requests efficiently
- For a game with ~100-1000 concurrent users, this generates negligible load

**Future consideration**: If real-time avatar updates become important, implement cache-busting via query parameter (e.g., `/avatar/42/small?v=1699999999`) controlled by the frontend.

### Request load estimation

With `max-age=3600` and 100 concurrent users:

```
Worst case (cache miss): 100 users × 20 avatars/page = 2000 req/hour = 0.5 req/sec
With browser cache: ~90% cache hit = 0.05 req/sec
```

This is negligible for any server. The bottleneck would be elsewhere (DB queries, game logic) long before avatar serving becomes an issue.

## Default avatar

Users without a custom avatar receive a default image.

### Implementation

Default images are embedded in the binary using `include_bytes!`:

```rust
const DEFAULT_AVATAR_LARGE: &[u8] = include_bytes!("../../assets/default_avatar_large.avif");
const DEFAULT_AVATAR_SMALL: &[u8] = include_bytes!("../../assets/default_avatar_small.avif");
```

**Advantages**:
- No filesystem I/O at runtime
- Always available (no "file not found" errors)
- Deployed with the binary (no separate asset management)
- Negligible binary size increase (~28KB total)

**Trade-off**:
- Changing the default avatar requires recompilation

## API endpoints

### `POST /api/avatar`

Upload or replace avatar images.

### `GET /api/avatar/<user_id>/large`

Retrieve large avatar (450x450).

### `GET /api/avatar/<user_id>/small`

Retrieve small avatar (200x200).

### `DELETE /api/avatar`

Delete own avatar.

## Security considerations

### Authorization

- Upload/delete: users can only modify their own avatar
- View: any authenticated user can view any avatar (public within the app)

### Input validation

- Base64 decoding with error handling
- Strict file size limits prevent memory exhaustion
- Full image decode catches malformed files
- No server side image processing (no ImageMagick style vulnerabilities)

### Rate limiting

Upload endpoint is rate-limited to prevent:
- Storage spam
- CPU exhaustion from repeated validation
- Database write amplification

### Database cleanup

Avatar records are automatically deleted when the user is deleted (ON DELETE CASCADE).
