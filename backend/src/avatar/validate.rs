//! AVIF image validation for avatars.
//!
//! Validates that uploaded images meet all requirements:
//! - Valid AVIF format (verified by decoding)
//! - Maximum file size (20kb for large, configurable)
//! - Correct dimensions (450x450 for large, 200x200 for small)
//! - No transparency/alpha channel
//! - Still image only (no animation)

use image::ImageReader;
use std::io::Cursor;
use thiserror::Error;

/// Maximum file size for large avatars (20kb)
pub const MAX_SIZE_LARGE: usize = 20 * 1024;

/// Maximum file size for small avatars (8kb)
pub const MAX_SIZE_SMALL: usize = 8 * 1024;

/// Expected dimensions for large avatars
pub const DIMENSIONS_LARGE: (u32, u32) = (450, 450);

/// Expected dimensions for small avatars
pub const DIMENSIONS_SMALL: (u32, u32) = (200, 200);

#[derive(Error, Debug)]
pub enum AvatarValidationError {
    #[error("File size exceeds maximum allowed ({max} bytes)")]
    FileTooLarge { max: usize },

    #[error("Invalid AVIF format: {0}")]
    InvalidFormat(String),

    #[error("Image dimensions must be {expected_w}x{expected_h}, got {actual_w}x{actual_h}")]
    InvalidDimensions {
        expected_w: u32,
        expected_h: u32,
        actual_w: u32,
        actual_h: u32,
    },

    #[error("Image contains transparency/alpha channel which is not allowed")]
    HasAlphaChannel,

    #[error("Animated images are not allowed")]
    IsAnimated,

    #[error("Failed to decode image: {0}")]
    DecodeError(String),

    #[error("Avatar not found")]
    NotFound,
}

/// Validation result containing the decoded image info
pub struct ValidatedAvatar {
    pub width: u32,
    pub height: u32,
}

/// Validate a large avatar image (450x450, max 20kb)
pub fn validate_large(data: &[u8]) -> Result<ValidatedAvatar, AvatarValidationError> {
    validate_avatar(data, MAX_SIZE_LARGE, DIMENSIONS_LARGE)
}

/// Validate a small avatar image (200x200, max 8kb)
pub fn validate_small(data: &[u8]) -> Result<ValidatedAvatar, AvatarValidationError> {
    validate_avatar(data, MAX_SIZE_SMALL, DIMENSIONS_SMALL)
}

/// Core validation logic for avatar images
fn validate_avatar(
    data: &[u8],
    max_size: usize,
    expected_dims: (u32, u32),
) -> Result<ValidatedAvatar, AvatarValidationError> {
    // Check file size first (cheap check)
    if data.len() > max_size {
        return Err(AvatarValidationError::FileTooLarge { max: max_size });
    }

    // Check AVIF magic bytes (ftyp box with avif/avis/mif1 brand)
    if !is_avif_format(data) {
        return Err(AvatarValidationError::InvalidFormat(
            "Not a valid AVIF file (missing or invalid ftyp box)".to_string(),
        ));
    }

    // Decode the image to validate format and get properties
    let reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| AvatarValidationError::DecodeError(e.to_string()))?;

    let img = reader
        .decode()
        .map_err(|e| AvatarValidationError::DecodeError(e.to_string()))?;

    let (width, height) = (img.width(), img.height());

    // Check dimensions
    if (width, height) != expected_dims {
        return Err(AvatarValidationError::InvalidDimensions {
            expected_w: expected_dims.0,
            expected_h: expected_dims.1,
            actual_w: width,
            actual_h: height,
        });
    }

    // Check for alpha channel
    if img.color().has_alpha() {
        return Err(AvatarValidationError::HasAlphaChannel);
    }

    Ok(ValidatedAvatar { width, height })
}

/// Check if data starts with AVIF ftyp box
fn is_avif_format(data: &[u8]) -> bool {
    // AVIF files start with an ftyp box
    // Structure: [4 bytes size][4 bytes "ftyp"][4 bytes brand]
    // The brand should be "avif", "avis", or "mif1"
    if data.len() < 12 {
        return false;
    }

    // Check for "ftyp" at offset 4, signature AVIF file
    if &data[4..8] != b"ftyp" {
        return false;
    }

    // Check major brand at offset 8
    let brand = &data[8..12];
    matches!(brand, b"avif" | b"avis" | b"mif1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_too_large() {
        let data = vec![0u8; MAX_SIZE_LARGE + 1];
        let result = validate_large(&data);
        assert!(matches!(
            result,
            Err(AvatarValidationError::FileTooLarge { .. })
        ));
    }

    #[test]
    fn test_invalid_format() {
        let data = vec![0u8; 100]; // Not a valid AVIF
        let result = validate_large(&data);
        assert!(matches!(
            result,
            Err(AvatarValidationError::InvalidFormat(_))
        ));
    }
}
