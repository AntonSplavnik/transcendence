use salvo::http::{StatusCode, StatusError};
use salvo::oapi::{self, EndpointOutRegister, ToSchema};
use salvo::prelude::*;
use thiserror::Error;

use crate::auth::{AuthError, TwoFactorError};
use crate::avatar::validate::AvatarValidationError;
use crate::email::{EmailConfirmationError, EmailError};
use crate::stream::StreamApiError;

#[derive(Error, Debug, strum::IntoStaticStr)]
pub enum GdprError {
    #[error("invalid or missing token")]
    InvalidToken,
    #[error("token has expired")]
    TokenExpired,
    #[error("email confirmation is still pending")]
    EmailConfirmationPending,
    #[error("account is already deleted")]
    AlreadyDeleted,
}

#[derive(Error, Debug, strum::IntoStaticStr)]
pub enum FriendError {
    #[error("cannot send friend request to yourself")]
    SelfRequest,
    #[error("friend request already exists")]
    DuplicateRequest,
    #[error("already friends with this user")]
    AlreadyFriends,
    #[error("friend request not found")]
    RequestNotFound,
    #[error("friend request is no longer pending")]
    RequestNotPending,
    #[error("not authorized to perform this action")]
    NotAuthorized,
    #[error("user not found")]
    UserNotFound,
    #[error("not friends with this user")]
    NotFriends,
    #[error("too many pending friend requests")]
    TooManyPending,
    #[error("friend list is full")]
    FriendListFull,
    #[error("invalid parameter: {0}")]
    InvalidParam(String),
}

#[derive(Error, Debug)]
#[error(transparent)]
pub enum ApiError {
    Validation(#[from] validator::ValidationErrors),
    PasswordHash(#[from] argon2::password_hash::Error),
    DatabaseQuery(#[from] diesel::result::Error),
    DatabaseConnection(#[from] diesel::ConnectionError),
    DatabaseConnectionPool(#[from] diesel::r2d2::PoolError),
    Stream(#[from] StreamApiError),
    Jwt(#[from] jsonwebtoken::errors::Error),
    Auth(#[from] AuthError),
    TwoFa(#[from] TwoFactorError),
    Avatar(#[from] AvatarValidationError),
    Friend(#[from] FriendError),
    Email(#[from] EmailError),
    EmailConfirmation(#[from] EmailConfirmationError),
    Gdpr(#[from] GdprError),
}

impl Scribe for ApiError {
    fn render(self, res: &mut Response) {
        let status_error = match self {
            // Validation errors -> 400 Bad Request with field details
            Self::Validation(errs) => StatusError::bad_request().brief(errs.to_string()),
            // Argon2 password hash errors
            Self::PasswordHash(err) => {
                use argon2::password_hash::Error;
                match err {
                    // Wrong password -> 401 Unauthorized
                    Error::Password => {
                        return Self::Auth(AuthError::InvalidCredentials).render(res);
                    }
                    // Other hashing errors are internal
                    err => {
                        tracing::error!(error = ?err, "Argon2 password hash error");
                        StatusError::internal_server_error()
                    }
                }
            }
            // Diesel SQL errors
            Self::DatabaseQuery(err) => {
                use diesel::result::{DatabaseErrorKind, Error};
                match err {
                    // Not found -> 404
                    Error::NotFound => StatusError::not_found().brief("Resource not found"),
                    // Database constraint errors
                    Error::DatabaseError(kind, info) => {
                        let message = info.message().to_string();
                        match kind {
                            // Unique violation -> 409 Conflict
                            // SQLite message format: "UNIQUE constraint failed: users.email"
                            DatabaseErrorKind::UniqueViolation => {
                                let field = message
                                    .strip_prefix("UNIQUE constraint failed: ")
                                    .and_then(|s| s.split('.').next_back())
                                    .unwrap_or("Value");
                                StatusError::conflict().brief(format!("{field} already exists"))
                            }
                            // Foreign key violation -> 400 Bad Request
                            DatabaseErrorKind::ForeignKeyViolation => StatusError::bad_request()
                                .brief("Referenced resource does not exist"),
                            // Check constraint violation -> 400 Bad Request
                            DatabaseErrorKind::CheckViolation => StatusError::bad_request()
                                .brief(format!("Constraint violation: {message}")),
                            // Not null violation -> 400 Bad Request
                            DatabaseErrorKind::NotNullViolation => {
                                StatusError::bad_request().brief("A required field is missing")
                            }
                            // Other database errors are internal
                            _ => {
                                tracing::error!(error = message, kind = ?kind, "Database error");
                                StatusError::internal_server_error()
                            }
                        }
                    }
                    // All other diesel errors are internal
                    err => {
                        tracing::error!(error = ?err, "Diesel error");
                        StatusError::internal_server_error()
                    }
                }
            }
            // Connection errors -> 500 Internal
            Self::DatabaseConnection(err) => {
                tracing::error!(error = ?err, "Database connection error");
                StatusError::internal_server_error()
            }
            // Pool errors -> 500 Internal
            Self::DatabaseConnectionPool(err) => {
                tracing::error!(error = ?err, "Database connection pool error");
                StatusError::internal_server_error()
            }
            Self::Jwt(err) => {
                tracing::error!(error = ?err, "JWT error");
                StatusError::internal_server_error()
            }
            Self::Auth(err) => {
                let variant: &'static str = err.into();
                StatusError::unauthorized().brief(variant)
            }
            Self::TwoFa(err) => match err {
                TwoFactorError::Internal(msg) => {
                    tracing::error!(error = %msg, "2FA internal error");
                    StatusError::internal_server_error()
                }
                variant => {
                    let variant: &'static str = variant.into();
                    StatusError::unauthorized().brief(variant)
                }
            },
            Self::Stream(err) => {
                tracing::error!(error = ?err, "Stream API error");
                StatusError::bad_request().brief(err.to_string())
            }
            Self::Avatar(err) => match err {
                AvatarValidationError::NotFound => {
                    StatusError::not_found().brief("Avatar not found")
                }
                _ => StatusError::bad_request().brief(err.to_string()),
            },
            Self::Email(err) => match err {
                EmailError::UnconfirmedEmail => {
                    StatusError::forbidden().brief("email is not confirmed")
                }
                err => {
                    tracing::error!(error = ?err, "email send failed");
                    StatusError::internal_server_error()
                }
            },
            Self::Gdpr(err) => {
                let variant: &'static str = (&err).into();
                match err {
                    GdprError::InvalidToken => StatusError::bad_request().brief(variant),
                    GdprError::TokenExpired => StatusError::gone().brief(variant),
                    GdprError::EmailConfirmationPending => {
                        StatusError::forbidden().brief(variant)
                    }
                    GdprError::AlreadyDeleted => StatusError::conflict().brief(variant),
                }
            }
            Self::EmailConfirmation(err) => {
                let variant: &'static str = (&err).into();
                match err {
                    EmailConfirmationError::UnconfirmedEmail => {
                        StatusError::forbidden().brief(variant)
                    }
                    EmailConfirmationError::AlreadyConfirmed => {
                        StatusError::conflict().brief(variant)
                    }
                    EmailConfirmationError::InvalidToken => {
                        StatusError::bad_request().brief(variant)
                    }
                }
            }
            Self::Friend(err) => {
                let variant: &'static str = (&err).into();
                match err {
                    FriendError::SelfRequest
                    | FriendError::DuplicateRequest
                    | FriendError::AlreadyFriends
                    | FriendError::TooManyPending
                    | FriendError::FriendListFull
                    | FriendError::InvalidParam(_) => StatusError::bad_request().brief(variant),
                    FriendError::RequestNotFound | FriendError::NotFriends => {
                        StatusError::not_found().brief(variant)
                    }
                    FriendError::RequestNotPending => StatusError::conflict().brief(variant),
                    FriendError::NotAuthorized => StatusError::forbidden().brief(variant),
                    FriendError::UserNotFound => StatusError::not_found().brief(variant),
                }
            }
        };

        res.render(status_error);
    }
}

impl EndpointOutRegister for ApiError {
    fn register(components: &mut oapi::Components, operation: &mut oapi::Operation) {
        let responses = [
            (StatusCode::BAD_REQUEST, "Bad request or validation error"),
            (StatusCode::NOT_FOUND, "Resource not found"),
            (StatusCode::FORBIDDEN, "Forbidden"),
            (StatusCode::CONFLICT, "Resource already exists"),
            (StatusCode::UNAUTHORIZED, "Unauthorized"),
            (StatusCode::GONE, "Resource expired"),
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
        ];

        for (status, description) in responses {
            operation.responses.insert(
                status.as_str(),
                oapi::Response::new(description)
                    .add_content("application/json", StatusError::to_schema(components)),
            );
        }
    }
}
