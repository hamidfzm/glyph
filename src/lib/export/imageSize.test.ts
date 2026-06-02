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
});
