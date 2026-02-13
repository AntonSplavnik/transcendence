//! Avatar API endpoints.
//!
//! Provides endpoints for uploading, fetching, and deleting user avatars.
//! Avatars are stored in two sizes: large (450x450) and small (200x200).

use super::cache;
use crate::avatar::DEFAULT_AVATAR_LARGE;
use crate::avatar::DEFAULT_AVATAR_SMALL;
use crate::avatar::validate::{AvatarValidationError, validate_large, validate_small};
use crate::models::{AvatarLarge, AvatarSmall};
use crate::prelude::*;
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use chrono::{DateTime, Utc};
use salvo::http::header;
use salvo::http::StatusCode;
use salvo::http::StatusCode;
use salvo::oapi::extract::PathParam;
use std::sync::LazyLock;

/// Static ETag for the default large avatar (never changes)
static DEFAULT_AVATAR_ETAG_LARGE: LazyLock<String> = LazyLock::new(|| {
    let hash = blake3::hash(DEFAULT_AVATAR_LARGE);
    let hex = hash.to_hex();
    let short = &hex.as_str()[..16];
    format!("\"{short}\"")
});

/// Static ETag for the default small avatar (never changes)
static DEFAULT_AVATAR_ETAG_SMALL: LazyLock<String> = LazyLock::new(|| {
    let hash = blake3::hash(DEFAULT_AVATAR_SMALL);
    let hex = hash.to_hex();
    let short = &hex.as_str()[..16];
    format!("\"{short}\"")
});

/// Generate an ETag from an `updated_at` timestamp
fn make_etag(updated_at: &DateTime<Utc>) -> String {
    let hash = blake3::hash(updated_at.to_string().as_bytes());
    let hex = hash.to_hex();
    let short = &hex.as_str()[..16];
    format!("\"{short}\"")
}

/// Write an avatar response with ETag support, returning 304 if the client's cache is fresh
fn write_avatar_response(req: &Request, res: &mut Response, data: impl AsRef<[u8]>, etag: &str) {
    if let Some(if_none_match) = req.headers().get(header::IF_NONE_MATCH) {
        if if_none_match.as_bytes() == etag.as_bytes() {
            res.status_code(StatusCode::NOT_MODIFIED);
            res.headers_mut()
                .insert(header::ETAG, etag.parse().unwrap());
            return;
        }
    }

    res.headers_mut()
        .insert(header::CONTENT_TYPE, "image/avif".parse().unwrap());
    res.headers_mut()
        .insert(header::CACHE_CONTROL, "no-cache".parse().unwrap());
    res.headers_mut()
        .insert(header::ETAG, etag.parse().unwrap());
    res.headers_mut()
        .insert(header::CONTENT_LENGTH, data.as_ref().len().into());
    res.write_body(data.as_ref().to_vec()).ok();
}

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("avatar")
        .push(
            Router::new()
                .requires_user_login()
                .user_rate_limit(&RateLimit::per_15_minutes(10))
                .post(upload_avatar)
                .delete(delete_avatar),
        )
        .push(
            Router::with_path("{user_id}/large")
                .requires_user_login()
                .get(get_avatar_large),
        )
        .push(
            Router::with_path("{user_id}/small")
                .requires_user_login()
                .get(get_avatar_small),
        )
}

/// Request body for avatar upload (JSON with base64-encoded images)
#[derive(Debug, Deserialize, ToSchema)]
struct UploadAvatarRequest {
    large: String,
    small: String,
}

impl UploadAvatarRequest {
    /// get large and small avatar images as bytes
    fn decode_base64_bytes(&self) -> Result<(Vec<u8>, Vec<u8>), AvatarValidationError> {
        Ok((
            BASE64_STANDARD.decode(&self.large)?,
            BASE64_STANDARD.decode(&self.small)?,
        ))
    }
}

/// Upload avatar
///
/// Accepts both large (450x450) and small (200x200) avatar variants.
/// Both must be valid AVIF images without transparency or animation.
#[endpoint]
async fn upload_avatar(
    depot: &mut Depot,
    json: JsonBody<UploadAvatarRequest>,
    db: Db,
) -> AppResult<()> {
    let user_id = depot.user_id();
    let request = json.into_inner();

    let (large_data, small_data) = request.decode_base64_bytes()?;

    validate_large(&large_data)?;
    validate_small(&small_data)?;

    let avatar_large = AvatarLarge::new(user_id, large_data);
    let avatar_small = AvatarSmall::new(user_id, small_data.clone());
    let updated_at = avatar_small.updated_at;

    // Store in database (upsert)
    db.write(move |conn| {
        diesel::replace_into(crate::schema::avatars_large::table)
            .values(&avatar_large)
            .execute(conn)?;

        diesel::replace_into(crate::schema::avatars_small::table)
            .values(&avatar_small)
            .execute(conn)?;
        Ok::<_, ApiError>(())
    })
    .await??;

    // Update cache with small avatar
    cache::insert(user_id, small_data, updated_at);

    tracing::info!(user_id = user_id, "Avatar uploaded successfully");

    Ok(())
}

/// Get large avatar
///
/// Retrieve the large (450x450) avatar for a user. Returns default avatar if none set.
#[endpoint]
async fn get_avatar_large(
    req: &mut Request,
    res: &mut Response,
    user_id: PathParam<i32>,
    db: Db,
) -> AppResult<()> {
    let user_id = user_id.into_inner();

    use crate::schema::avatars_large::dsl;
    let avatar = db
        .read(move |conn| {
            dsl::avatars_large
                .filter(dsl::user_id.eq(user_id))
                .first::<AvatarLarge>(conn)
        })
        .await?;

    match avatar {
        Ok(avatar) => {
            let etag = make_etag(&avatar.updated_at);
            write_avatar_response(req, res, avatar.data, &etag);
        }
        Err(_) => {
            write_avatar_response(req, res, DEFAULT_AVATAR_LARGE, &DEFAULT_AVATAR_ETAG_LARGE);
        }
    }

    Ok(())
}

/// Get small avatar for a user
///
/// Retrieve the small (200x200) avatar for a user. Returns default avatar if none set. This endpoint is cached.
#[endpoint]
async fn get_avatar_small(
    req: &mut Request,
    res: &mut Response,
    user_id: PathParam<i32>,
    db: Db,
) -> AppResult<()> {
    let user_id = user_id.into_inner();

    // Try cache first
    if let Some(cached) = cache::get(user_id) {
        let etag = make_etag(&cached.updated_at);
        write_avatar_response(req, res, cached.data.as_ref(), &etag);
        return Ok(());
    }

    // Fallback to database
    use crate::schema::avatars_small::dsl;
    let avatar = db
        .read(move |conn| {
            dsl::avatars_small
                .filter(dsl::user_id.eq(user_id))
                .first::<AvatarSmall>(conn)
        })
        .await?;

    match avatar {
        Ok(avatar) => {
            let etag = make_etag(&avatar.updated_at);
            cache::insert(user_id, avatar.data.clone(), avatar.updated_at);
            write_avatar_response(req, res, avatar.data, &etag);
        }
        Err(_) => {
            write_avatar_response(req, res, DEFAULT_AVATAR_SMALL, &DEFAULT_AVATAR_ETAG_SMALL);
        }
    }

    Ok(())
}

/// Delete own avatar
#[endpoint]
async fn delete_avatar(depot: &mut Depot, db: Db) -> AppResult<()> {
    let user_id = depot.user_id();

    db.write(move |conn| {
        // Delete from both tables
        {
            use crate::schema::avatars_large::dsl;
            diesel::delete(dsl::avatars_large.filter(dsl::user_id.eq(user_id)))
                .execute(conn)
                .ok();
        }

        {
            use crate::schema::avatars_small::dsl;
            diesel::delete(dsl::avatars_small.filter(dsl::user_id.eq(user_id)))
                .execute(conn)
                .ok();
        }

        Ok::<_, ApiError>(())
    })
    .await??;

    // Invalidate cache
    cache::invalidate(user_id);

    tracing::info!(user_id = user_id, "Avatar deleted");

    Ok(())
}
