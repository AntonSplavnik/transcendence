//! AVIF image validation for avatars.
//!
//! Validates that uploaded images meet all requirements:
//! - Valid AVIF format (verified by decoding)
//! - Maximum file size (20kb for large, configurable)
//! - Correct dimensions (450x450 for large, 200x200 for small)
//! - No transparency/alpha channel
//! - Still image only (no animation)

use image::{
    codecs::avif::AvifDecoder, EncodableLayout, ImageDecoder, ImageError, Pixel, Primitive,
    RgbaImage,
};
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

    #[error("Image dimensions must be {expected:?}, got {actual:?}")]
    InvalidDimensions {
        expected: (u32, u32),
        actual: (u32, u32),
    },

    #[error("Image contains transparency which is not allowed")]
    HasTransparency,

    #[error("Animated images are not allowed")]
    IsAnimated,

    #[error("Failed to decode image: {0}")]
    InternalImageError(#[from] ImageError),

    #[error("Invalid Base64 format: {0}")]
    Base64DecodeError(#[from] base64::DecodeError),

    #[error("Image is not in RGBA8 format")]
    NotRgba8,

    #[error("Avatar not found")]
    NotFound,
}

/// Validate a large avatar image (450x450, max 20kb)
pub fn validate_large(data: &[u8]) -> Result<(), AvatarValidationError> {
    validate_avatar(data, MAX_SIZE_LARGE, DIMENSIONS_LARGE)
}

/// Validate a small avatar image (200x200, max 8kb)
pub fn validate_small(data: &[u8]) -> Result<(), AvatarValidationError> {
    validate_avatar(data, MAX_SIZE_SMALL, DIMENSIONS_SMALL)
}

/// Core validation logic for avatar images
fn validate_avatar(
    data: &[u8],
    max_size: usize,
    expected_dims: (u32, u32),
) -> Result<(), AvatarValidationError> {
    // Check file size first (cheap check)
    if data.len() > max_size {
        return Err(AvatarValidationError::FileTooLarge { max: max_size });
    }

    // Reject animated AVIF sequences before attempting to decode
    if is_animated_avif(data) {
        return Err(AvatarValidationError::IsAnimated);
    }

    let img = decode_avif_with_dims(data, expected_dims)?;

    // Check if alpha channel has any non-opaque pixels
    if img
        .pixels()
        .any(|px| px.alpha() != <u8 as Primitive>::DEFAULT_MAX_VALUE)
    {
        return Err(AvatarValidationError::HasTransparency);
    }

    Ok(())
}

/// Check whether the raw bytes represent an animated AVIF by inspecting the
/// ISOBMFF `ftyp` box for the `avis` (AVIF sequence) brand.
///
/// The `ftyp` box layout (ISO 14496-12):
///   - 4 bytes  box size (big-endian u32)
///   - 4 bytes  box type (`ftyp`)
///   - 4 bytes  major brand
///   - 4 bytes  minor version
///   - N×4 bytes compatible brands
fn is_animated_avif(data: &[u8]) -> bool {
    const AVIS: &[u8; 4] = b"avis";

    // Minimum ftyp box: size(4) + type(4) + major(4) + minor_ver(4) = 16
    if data.len() < 16 {
        return false;
    }

    // Verify the box type is `ftyp`
    if &data[4..8] != b"ftyp" {
        return false;
    }

    let box_size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
    // Clamp to available data so a truncated file doesn't cause a panic
    let box_end = box_size.min(data.len());

    // Check major brand (bytes 8..12)
    if &data[8..12] == AVIS {
        return true;
    }

    // Check compatible brands (starting at byte 16, in 4-byte chunks)
    let mut offset = 16;
    while offset + 4 <= box_end {
        if &data[offset..offset + 4] == AVIS {
            return true;
        }
        offset += 4;
    }

    false
}

fn decode_avif_with_dims(
    data: &[u8],
    dims: (u32, u32),
) -> Result<RgbaImage, AvatarValidationError> {
    let decoder = AvifDecoder::new(data)?;
    let actual_dims = decoder.dimensions();
    if actual_dims != dims {
        return Err(AvatarValidationError::InvalidDimensions {
            expected: dims,
            actual: actual_dims,
        });
    }
    let mut img = RgbaImage::new(dims.0, dims.1);
    let total_bytes = usize::try_from(decoder.total_bytes()).unwrap_or(usize::MAX);
    if img.as_bytes().len() != total_bytes {
        return Err(AvatarValidationError::NotRgba8);
    }
    decoder.read_image(&mut img)?;
    Ok(img)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANIMATED_AVIF: &[u8] = include_bytes!("../../assets/animated.avif");

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
            Err(AvatarValidationError::InternalImageError(_))
        ));
    }

    #[test]
    fn test_valid() {
        validate_large(crate::avatar::DEFAULT_AVATAR_LARGE).expect("Default avatar large is valid");
        validate_small(crate::avatar::DEFAULT_AVATAR_SMALL).expect("Default avatar small is valid");
    }

    #[test]
    fn test_animated_disallowed() {
        let result = dbg!(validate_avatar(ANIMATED_AVIF, usize::MAX, (480, 360)));
        assert!(matches!(result, Err(AvatarValidationError::IsAnimated)));
    }
}
