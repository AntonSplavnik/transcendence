// Type declarations for @jsquash packages

declare module "@jsquash/avif/encode" {
  interface EncodeOptions {
    quality?: number;
    speed?: number;
    subsample?: number;
  }

  export default function encode(
    imageData: ImageData,
    options?: EncodeOptions
  ): Promise<ArrayBuffer>;
}

declare module "@jsquash/avif/decode" {
  export default function decode(buffer: ArrayBuffer): Promise<ImageData>;
}

declare module "@jsquash/resize" {
  interface ResizeOptions {
    width: number;
    height?: number;
    fitMethod?: "stretch" | "contain";
  }

  export default function resize(
    imageData: ImageData,
    options: ResizeOptions
  ): Promise<ImageData>;
}
