/**
 * Avatar AVIF Converter
 *
 * Converts images to AVIF format for avatar uploads.
 * Uses @jsquash/avif for encoding and @jsquash/resize for resizing.
 *
 * Produces two variants:
 * - Large: 450x450px, max 20KB
 * - Small: 200x200px, max 8KB
 */

import encode from "@jsquash/avif/encode";
import resize from "@jsquash/resize";

const LARGE_SIZE = 450;
const SMALL_SIZE = 200;
const AVIF_QUALITY = 60;
const MAX_LARGE_BYTES = 20 * 1024;
const MAX_SMALL_BYTES = 8 * 1024;

export interface AvatarVariants {
  large: Blob;
  small: Blob;
}

export interface ConversionError {
  type: "decode" | "resize" | "encode" | "size";
  message: string;
}

export type ConversionResult =
  | { success: true; data: AvatarVariants }
  | { success: false; error: ConversionError };

/**
 * Decode an image file to ImageData using the browser's native decoder.
 */
async function decodeImage(file: File | Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Resize an image to a square (center crop + resize).
 */
async function resizeToSquare(
  imageData: ImageData,
  targetSize: number
): Promise<ImageData> {
  const { width, height } = imageData;

  // Center crop to square, smallest side
  const cropSize = Math.min(width, height);
  const cropX = Math.floor((width - cropSize) / 2);
  const cropY = Math.floor((height - cropSize) / 2);

  // Create cropped ImageData
  const croppedCanvas = new OffscreenCanvas(cropSize, cropSize);
  const croppedCtx = croppedCanvas.getContext("2d");

  if (!croppedCtx) {
    throw new Error("Failed to get canvas context");
  }

  // Put the original image data on a temp canvas first
  const tempCanvas = new OffscreenCanvas(width, height);
  const tempCtx = tempCanvas.getContext("2d");

  if (!tempCtx) {
    throw new Error("Failed to get temp canvas context");
  }

  tempCtx.putImageData(imageData, 0, 0);

  // Draw cropped region
  croppedCtx.drawImage(
    tempCanvas,
    cropX,
    cropY,
    cropSize,
    cropSize,
    0,
    0,
    cropSize,
    cropSize
  );

  const croppedData = croppedCtx.getImageData(0, 0, cropSize, cropSize);

  // Resize to target size
  return await resize(croppedData, {
    width: targetSize,
    height: targetSize,
  });
}

/**
 * Encode ImageData to AVIF with quality 60.
 */
async function encodeToAvif(imageData: ImageData): Promise<Blob> {
  const encoded = await encode(imageData, { quality: AVIF_QUALITY });
  return new Blob([encoded], { type: "image/avif" });
}

/**
 * Convert an image file to AVIF avatar variants.
 *
 * @param file - The input image file (any browser-supported format)
 * @returns Both large and small AVIF variants, or an error
 */
export async function convertToAvatarAvif(
  file: File | Blob
): Promise<ConversionResult> {
  try {
    // Decode the input image
    let imageData: ImageData;
    try {
      imageData = await decodeImage(file);
    } catch (e) {
      return {
        success: false,
        error: {
          type: "decode",
          message: `Failed to decode image: ${e instanceof Error ? e.message : "Unknown error"}`,
        },
      };
    }

    // Resize to large variant
    let largeData: ImageData;
    try {
      largeData = await resizeToSquare(imageData, LARGE_SIZE);
    } catch (e) {
      return {
        success: false,
        error: {
          type: "resize",
          message: `Failed to resize to large: ${e instanceof Error ? e.message : "Unknown error"}`,
        },
      };
    }

    // Resize to small variant
    let smallData: ImageData;
    try {
      smallData = await resizeToSquare(imageData, SMALL_SIZE);
    } catch (e) {
      return {
        success: false,
        error: {
          type: "resize",
          message: `Failed to resize to small: ${e instanceof Error ? e.message : "Unknown error"}`,
        },
      };
    }

    // Encode both variants to AVIF
    let largeBlob: Blob;
    let smallBlob: Blob;
    try {
      [largeBlob, smallBlob] = await Promise.all([
        encodeToAvif(largeData),
        encodeToAvif(smallData),
      ]);
    } catch (e) {
      return {
        success: false,
        error: {
          type: "encode",
          message: `Failed to encode AVIF: ${e instanceof Error ? e.message : "Unknown error"}`,
        },
      };
    }

    // Final size check
    if (largeBlob.size > MAX_LARGE_BYTES) {
      return {
        success: false,
        error: {
          type: "size",
          message: `Large variant exceeds ${MAX_LARGE_BYTES / 1024}KB limit`,
        },
      };
    }

    if (smallBlob.size > MAX_SMALL_BYTES) {
      return {
        success: false,
        error: {
          type: "size",
          message: `Small variant exceeds ${MAX_SMALL_BYTES / 1024}KB limit`,
        },
      };
    }

    return {
      success: true,
      data: {
        large: largeBlob,
        small: smallBlob,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: {
        type: "encode",
        message: `Unexpected error: ${e instanceof Error ? e.message : "Unknown error"}`,
      },
    };
  }
}
