// Minimal intrinsic-dimension probes for the raster formats a markdown
// document is likely to embed. Used by the DOCX exporter, which must know a
// picture's pixel size up front (unlike HTML/EPUB, where the reader lays it
// out). Returns null for formats we don't parse (e.g. SVG) so the caller can
// fall back to alt text.

export interface ImageSize {
  width: number;
  height: number;
}

export type DocxImageType = "png" | "jpg" | "gif" | "bmp";

export interface DecodedImage extends ImageSize {
  type: DocxImageType;
  data: Uint8Array;
}

function parsePng(b: Uint8Array): ImageSize | null {
  // 8-byte signature, then IHDR whose width/height are big-endian u32 at 16/20.
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  const view = new DataView(b.buffer, b.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function parseGif(b: Uint8Array): ImageSize | null {
  // "GIF" then little-endian u16 width/height at bytes 6 and 8.
  if (b.length < 10 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  const view = new DataView(b.buffer, b.byteOffset);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function parseJpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const view = new DataView(b.buffer, b.byteOffset);
  let offset = 2;
  while (offset + 9 <= b.length) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    // SOF0..SOF15 (excluding the non-frame markers) carry height/width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const TYPE_BY_MIME: Record<string, DocxImageType> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

/**
 * Decode a `data:` image URI into raw bytes, a docx-compatible type tag, and
 * intrinsic dimensions. Returns null for unsupported or undecodable sources.
 */
export function decodeDataUri(src: string): DecodedImage | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!match) return null;
  const type = TYPE_BY_MIME[match[1].toLowerCase()];
  if (!type) return null;

  let data: Uint8Array;
  try {
    data = match[2]
      ? decodeBase64(match[3])
      : new TextEncoder().encode(decodeURIComponent(match[3]));
  } catch {
    return null;
  }

  const size = parsePng(data) ?? parseJpeg(data) ?? parseGif(data);
  // BMP dimensions live at a fixed offset; only probe if the others missed.
  const resolved =
    size ??
    (type === "bmp" && data.length >= 26
      ? {
          width: new DataView(data.buffer, data.byteOffset).getInt32(18, true),
          height: Math.abs(new DataView(data.buffer, data.byteOffset).getInt32(22, true)),
        }
      : null);
  if (!resolved || resolved.width <= 0 || resolved.height <= 0) return null;
  return { type, data, ...resolved };
}
