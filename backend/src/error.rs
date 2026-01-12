use salvo::http::{StatusCode, StatusError};
use salvo::oapi::{self, EndpointOutRegister, ToSchema};
use salvo::prelude::*;
use thiserror::Error;

use crate::auth::{AuthError, TwoFactorError};
use crate::stream::StreamApiError;

#[derive(Error, Debug)]
#[error(transparent)]
pub enum ApiError {
    Validation(#[from] validator::ValidationErrors),
    PasswordHash(#[from] argon2::password_hash::Error),
    DatabaseSQL(#[from] diesel::result::Error),
    DatabaseConnection(#[from] diesel::ConnectionError),
    DatabaseConnectionPool(#[from] diesel::r2d2::PoolError),
    Stream(#[from] StreamApiError),
    Jwt(#[from] jsonwebtoken::errors::Error),
    Auth(#[from] AuthError),
    TwoFa(#[from] TwoFactorError),
}

impl Scribe for ApiError {
    fn render(self, res: &mut Response) {
        let status_error = match self {
            // Validation errors -> 400 Bad Request with field details
            Self::Validation(errs) => {
                StatusError::bad_request().brief(errs.to_string())
            }
            // Argon2 password hash errors
            Self::PasswordHash(err) => {
                use argon2::password_hash::Error;
                match err {
                    // Wrong password -> 401 Unauthorized
                    Error::Password => {
                        return ApiError::Auth(AuthError::InvalidCredentials)
                            .render(res);
                    }
                    // Other hashing errors are internal
                    err => {
                        tracing::error!(error = ?err, "Argon2 password hash error");
                        StatusError::internal_server_error()
                    }
                }
            }
            // Diesel SQL errors
            Self::DatabaseSQL(err) => {
                use diesel::result::{DatabaseErrorKind, Error};
                match err {
                    // Not found -> 404
                    Error::NotFound => {
                        StatusError::not_found().brief("Resource not found")
                    }
                    // Database constraint errors
                    Error::DatabaseError(kind, info) => {
                        let message = info.message().to_string();
                        match kind {
                            // Unique violation -> 409 Conflict
                            // SQLite message format: "UNIQUE constraint failed: users.email"
                            DatabaseErrorKind::UniqueViolation => {
                                let field = message
                                    .strip_prefix("UNIQUE constraint failed: ")
                                    .and_then(|s| s.split('.').last())
                                    .unwrap_or("Value");
                                StatusError::conflict()
                                    .brief(format!("{} already exists", field))
                            }
                            // Foreign key violation -> 400 Bad Request
                            DatabaseErrorKind::ForeignKeyViolation => {
                                StatusError::bad_request()
                                    .brief("Referenced resource does not exist")
                            }
                            // Check constraint violation -> 400 Bad Request
                            DatabaseErrorKind::CheckViolation => {
                                StatusError::bad_request().brief(format!(
                                    "Constraint violation: {}",
                                    message
                                ))
                            }
                            // Not null violation -> 400 Bad Request
                            DatabaseErrorKind::NotNullViolation => {
                                StatusError::bad_request()
                                    .brief("A required field is missing")
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
        };

        res.render(status_error);
    }
}

impl EndpointOutRegister for ApiError {
    fn register(
        components: &mut oapi::Components,
        operation: &mut oapi::Operation,
    ) {
        let responses = [
            (StatusCode::BAD_REQUEST, "Bad request or validation error"),
            (StatusCode::NOT_FOUND, "Resource not found"),
            (StatusCode::CONFLICT, "Resource already exists"),
            (StatusCode::UNAUTHORIZED, "Unauthorized"),
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
        ];

        for (status, description) in responses {
            operation.responses.insert(
                status.as_str(),
                oapi::Response::new(description).add_content(
                    "application/json",
                    StatusError::to_schema(components),
                ),
            );
        }
    }
}
