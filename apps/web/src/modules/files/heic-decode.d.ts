// Типы heic-decode 2.1 по его README (node_modules/heic-decode/README.md) и lib.js:
// у @types/heic-decode 2.0.0 нет width/height до раскодирования и dispose() у decode.all.
declare module "heic-decode" {
  type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };
  type PendingImage = { width: number; height: number; decode(): Promise<DecodedImage> };

  function decode(input: { buffer: Uint8Array }): Promise<DecodedImage>;
  namespace decode {
    /** Все изображения файла без раскодирования; после работы обязательно dispose(). */
    function all(input: { buffer: Uint8Array }): Promise<PendingImage[] & { dispose(): void }>;
  }
  export = decode;
}
