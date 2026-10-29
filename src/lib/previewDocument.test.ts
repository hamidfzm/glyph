import { describe, expect, it } from "vitest";
import { decodeUtf8, MAX_DOCUMENT_BYTES } from "./previewDocument";

describe("MAX_DOCUMENT_BYTES", () => {
  // preview.json is checked by the Windows and Quick Look builds too, but only
  // on their own platform jobs; this fails the frontend gate everywhere.
  it("is a positive whole number of bytes from preview.json", () => {
    expect(Number.isInteger(MAX_DOCUMENT_BYTES)).toBe(true);
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(0);
  });
});

describe("decodeUtf8", () => {
  it("decodes UTF-8 and drops a leading BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("# Hi")]);
    expect(decodeUtf8(bytes)).toBe("# Hi");
  });

  it("returns null for bytes that are not UTF-8", () => {
    expect(decodeUtf8(new Uint8Array([0x48, 0xff, 0xfe]))).toBeNull();
  });

  it("keeps an empty document distinct from an unreadable one", () => {
    expect(decodeUtf8(new Uint8Array())).toBe("");
  });
});
