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
use salvo::http::header;
use salvo::oapi::extract::PathParam;

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
    cache::insert(user_id, small_data);

    tracing::info!(user_id = user_id, "Avatar uploaded successfully");

    Ok(())
}

/// Get large avatar
///
/// Retrieve the large (450x450) avatar for a user. Returns default avatar if none set.
#[endpoint]
async fn get_avatar_large(res: &mut Response, user_id: PathParam<i32>, db: Db) -> AppResult<()> {
    let user_id = user_id.into_inner();

    use crate::schema::avatars_large::dsl;
    let data = db
        .read(move |conn| {
            dsl::avatars_large
                .filter(dsl::user_id.eq(user_id))
                .first::<AvatarLarge>(conn)
        })
        .await?
        .map(|avatar| avatar.data)
        .unwrap_or_else(|_| DEFAULT_AVATAR_LARGE.to_vec());

    res.headers_mut()
        .insert(header::CONTENT_TYPE, "image/avif".parse().unwrap());
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        "public, max-age=3600".parse().unwrap(),
    );
    res.headers_mut()
        .insert(header::CONTENT_LENGTH, data.len().into());
    res.write_body(data).ok();

    Ok(())
}

/// Get small avatar for a user
///
/// Retrieve the small (200x200) avatar for a user. Returns default avatar if none set. This endpoint is cached.
#[endpoint]
async fn get_avatar_small(res: &mut Response, user_id: PathParam<i32>, db: Db) -> AppResult<()> {
    let user_id = user_id.into_inner();

    // Try cache first
    if let Some(cached) = cache::get(user_id) {
        res.headers_mut()
            .insert(header::CONTENT_TYPE, "image/avif".parse().unwrap());
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            "public, max-age=3600".parse().unwrap(),
        );
        res.headers_mut()
            .insert(header::CONTENT_LENGTH, cached.len().into());
        res.write_body(cached.as_ref().clone()).ok();
        return Ok(());
    }

    // Fallback to database
    use crate::schema::avatars_small::dsl;
    let data = db
        .read(move |conn| {
            dsl::avatars_small
                .filter(dsl::user_id.eq(user_id))
                .first::<AvatarSmall>(conn)
        })
        .await?
        .map(|avatar| {
            cache::insert(user_id, avatar.data.clone());
            avatar.data
        })
        .unwrap_or_else(|_| DEFAULT_AVATAR_SMALL.to_vec());

    res.headers_mut()
        .insert(header::CONTENT_TYPE, "image/avif".parse().unwrap());
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        "public, max-age=3600".parse().unwrap(),
    );
    res.headers_mut()
        .insert(header::CONTENT_LENGTH, data.len().into());
    res.write_body(data).ok();

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
