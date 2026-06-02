import { describe, expect, it } from "vitest";
import { decodeDataUri } from "./imageSize";

function dataUri(mime: string, bytes: number[]): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(binary)}`;
}

describe("decodeDataUri", () => {
  it("reads PNG dimensions from the IHDR chunk", () => {
    const bytes = new Array(24).fill(0);
    bytes[0] = 0x89;
    bytes[1] = 0x50;
    bytes[19] = 4; // width = 4 (big-endian u32 at offset 16)
    bytes[23] = 2; // height = 2 (big-endian u32 at offset 20)
    const out = decodeDataUri(dataUri("image/png", bytes));
    expect(out).toMatchObject({ type: "png", width: 4, height: 2 });
  });

  it("reads JPEG dimensions from the SOF0 marker", () => {
    const bytes = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x07, 0x00, 0x09];
    const out = decodeDataUri(dataUri("image/jpeg", bytes));
    expect(out).toMatchObject({ type: "jpg", width: 9, height: 7 });
  });

  it("reads GIF dimensions from the header", () => {
    const bytes = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 5, 0];
    const out = decodeDataUri(dataUri("image/gif", bytes));
    expect(out).toMatchObject({ type: "gif", width: 3, height: 5 });
  });

  it("returns null for unsupported mime types", () => {
    expect(decodeDataUri("data:image/svg+xml;base64,AAAA")).toBeNull();
  });

  it("returns null for non-data URIs", () => {
    expect(decodeDataUri("https://example.com/a.png")).toBeNull();
  });

  it("returns null when dimensions can't be parsed", () => {
    expect(decodeDataUri(dataUri("image/png", [0x89, 0x50, 0, 0]))).toBeNull();
  });

  it("reads BMP dimensions from the fixed header offsets", () => {
    const bytes = new Array(26).fill(0);
    bytes[18] = 4; // width (little-endian int32 at offset 18)
    bytes[22] = 3; // height (little-endian int32 at offset 22)
    const out = decodeDataUri(dataUri("image/bmp", bytes));
    expect(out).toMatchObject({ type: "bmp", width: 4, height: 3 });
  });

  it("skips non-SOF JPEG segments before reading dimensions", () => {
    // FFD8, APP0 (FFE0 len=4), then SOF0 (FFC0) with 9x7.
    const bytes = [
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x07,
      0x00, 0x09,
    ];
    expect(decodeDataUri(dataUri("image/jpeg", bytes))).toMatchObject({ width: 9, height: 7 });
  });

  it("decodes non-base64 (url-encoded) data URIs", () => {
    // Supported type but undecodable as an image → exercises the text decode
    // path and the null-dimension guard.
    expect(decodeDataUri("data:image/png,hello%20world")).toBeNull();
  });

  it("returns null when base64 can't be decoded", () => {
    expect(decodeDataUri("data:image/png;base64,@@not-base64@@")).toBeNull();
  });

  it("advances past stray non-marker bytes in the JPEG scan", () => {
    // A non-0xFF byte at the scan position (index 2) must be skipped before the
    // SOF0 marker at index 3.
    const bytes = [0xff, 0xd8, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x07, 0x00, 0x09];
    expect(decodeDataUri(dataUri("image/jpeg", bytes))).toMatchObject({ width: 9, height: 7 });
  });

  it("skips non-frame markers (e.g. DHT 0xC4) when locating the JPEG SOF", () => {
    const bytes = [
      0xff, 0xd8, 0xff, 0xc4, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x07,
      0x00, 0x09,
    ];
    expect(decodeDataUri(dataUri("image/jpeg", bytes))).toMatchObject({ width: 9, height: 7 });
  });
});
