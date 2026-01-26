//! Avatar API endpoints.
//!
//! Provides endpoints for uploading, fetching, and deleting user avatars.
//! Avatars are stored in two sizes: large (450x450) and small (200x200).

use salvo::http::header;

use super::{cache, validate};
use crate::models::{AvatarLarge, AvatarSmall};
use crate::prelude::*;

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("avatar")
        .push(
            Router::new()
                .requires_user_login()
                .post(upload_avatar)
                .delete(delete_avatar),
        )
        .push(
            Router::with_path("<user_id>/large")
                .requires_user_login()
                .get(get_avatar_large),
        )
        .push(
            Router::with_path("<user_id>/small")
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

/// Upload or update avatar images
///
/// Accepts both large (450x450) and small (200x200) avatar variants.
/// Both must be valid AVIF images without transparency or animation.
#[endpoint(
    summary = "Upload avatar",
    description = "Upload both large and small avatar variants. Images must be AVIF format."
)]
async fn upload_avatar(
    depot: &mut Depot,
    json: JsonBody<UploadAvatarRequest>,
) -> AppResult<()> {
    let user_id = depot.user_id();
    let request = json.into_inner();

    // Decode base64
    let large_data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &request.large,
    )
    .map_err(|e| {
        validate::AvatarValidationError::InvalidFormat(format!(
            "Invalid base64 for large avatar: {}",
            e
        ))
    })?;

    let small_data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &request.small,
    )
    .map_err(|e| {
        validate::AvatarValidationError::InvalidFormat(format!(
            "Invalid base64 for small avatar: {}",
            e
        ))
    })?;

    // Validate both images
    validate::validate_large(&large_data)?;
    validate::validate_small(&small_data)?;

    // Store in database (upsert)
    let conn = &mut db::get()?;

    let avatar_large = AvatarLarge::new(user_id, large_data);
    let avatar_small = AvatarSmall::new(user_id, small_data.clone());

    // Use INSERT OR REPLACE for upsert behavior
    diesel::replace_into(crate::schema::avatars_large::table)
        .values(&avatar_large)
        .execute(conn)?;

    diesel::replace_into(crate::schema::avatars_small::table)
        .values(&avatar_small)
        .execute(conn)?;

    // Update cache with small avatar
    cache::insert(user_id, small_data);

    tracing::info!(user_id = user_id, "Avatar uploaded successfully");

    Ok(())
}

/// Get large avatar for a user
#[endpoint(
    summary = "Get large avatar",
    description = "Retrieve the large (450x450) avatar for a user"
)]
async fn get_avatar_large(req: &mut Request, res: &mut Response) -> AppResult<()> {
    let user_id: i32 = req
        .param("user_id")
        .ok_or(validate::AvatarValidationError::NotFound)?;

    let conn = &mut db::get()?;

    use crate::schema::avatars_large::dsl;
    let avatar: AvatarLarge = dsl::avatars_large
        .filter(dsl::user_id.eq(user_id))
        .first(conn)
        .map_err(|_| validate::AvatarValidationError::NotFound)?;

    res.headers_mut()
        .insert(header::CONTENT_TYPE, "image/avif".parse().unwrap());
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        "public, max-age=3600".parse().unwrap(),
    );
    res.write_body(avatar.data).ok();

    Ok(())
}

/// Get small avatar for a user
#[endpoint(
    summary = "Get small avatar",
    description = "Retrieve the small (200x200) avatar for a user. This endpoint is cached."
)]
async fn get_avatar_small(req: &mut Request, res: &mut Response) -> AppResult<()> {
    let user_id: i32 = req
        .param("user_id")
        .ok_or(validate::AvatarValidationError::NotFound)?;

    // Try cache first
    if let Some(cached) = cache::get(user_id) {
        res.headers_mut()
            .insert(header::CONTENT_TYPE, "image/avif".parse().unwrap());
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            "public, max-age=3600".parse().unwrap(),
        );
        res.write_body(cached.as_ref().clone()).ok();
        return Ok(());
    }

    // Fallback to database
    let conn = &mut db::get()?;

    use crate::schema::avatars_small::dsl;
    let avatar: AvatarSmall = dsl::avatars_small
        .filter(dsl::user_id.eq(user_id))
        .first(conn)
        .map_err(|_| validate::AvatarValidationError::NotFound)?;

    // Populate cache for next time
    cache::insert(user_id, avatar.data.clone());

    res.headers_mut()
        .insert(header::CONTENT_TYPE, "image/avif".parse().unwrap());
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        "public, max-age=3600".parse().unwrap(),
    );
    res.write_body(avatar.data).ok();

    Ok(())
}

/// Delete own avatar
#[endpoint(
    summary = "Delete avatar",
    description = "Delete the authenticated user's avatar (both sizes)"
)]
async fn delete_avatar(depot: &mut Depot) -> AppResult<()> {
    let user_id = depot.user_id();

    let conn = &mut db::get()?;

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

    // Invalidate cache
    cache::invalidate(user_id);

    tracing::info!(user_id = user_id, "Avatar deleted");

    Ok(())
}
