import { deflateRawSync, inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES } from "@/lib/previewDocument";
import { decodeDocument, encodeDocument, MAX_LINK_LENGTH } from "./linkCodec";

// An encoder independent of the one under test, so a bug symmetric in both
// halves of the codec cannot pass the round trip unnoticed.
function zlibFragment(bytes: Uint8Array): string {
  return `v1.${Buffer.from(deflateRawSync(bytes)).toString("base64url")}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("link codec", () => {
  it.each([
    ["ASCII", "# Title\n\nSome *text* and `code`."],
    ["emoji", "Ship it 🚀 and 👩🏽‍💻"],
    ["Persian", "# سلام دنیا\n\nاین یک سند است."],
    ["CJK", "# 你好，世界\n\n这是一个文档。"],
    ["empty", ""],
  ])("round-trips %s text", async (_name, content) => {
    expect(await decodeDocument(await encodeDocument(content))).toBe(content);
  });

  it("writes a versioned, URL-safe fragment that plain zlib can read", async () => {
    const fragment = await encodeDocument("# Interop ✓");
    expect(fragment).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    const payload = Buffer.from(fragment.slice("v1.".length), "base64url");
    expect(inflateRawSync(payload).toString("utf8")).toBe("# Interop ✓");
  });

  it("reads a fragment that plain zlib wrote", async () => {
    expect(await decodeDocument(zlibFragment(new TextEncoder().encode("# From zlib")))).toBe(
      "# From zlib",
    );
  });

  it.each([
    ["no prefix", "SGVsbG8"],
    ["an unknown version", "v2.SGVsbG8"],
    ["an empty fragment", ""],
    ["characters outside base64url", "v1.ab+c/d=="],
    ["a percent escape", "v1.ab%20cd"],
    ["base64 of an impossible length", "v1.abcde"],
  ])("rejects %s", async (_name, fragment) => {
    expect(await decodeDocument(fragment)).toBeNull();
  });

  it("rejects a fragment longer than any link the viewer makes", async () => {
    expect(await decodeDocument(`v1.${"A".repeat(MAX_LINK_LENGTH)}`)).toBeNull();
  });

  it("rejects a truncated link", async () => {
    const fragment = await encodeDocument("# A document long enough to cut in half ".repeat(20));
    expect(await decodeDocument(fragment.slice(0, fragment.length / 2))).toBeNull();
  });

  it("rejects data that is not deflate", async () => {
    expect(
      await decodeDocument(`v1.${Buffer.from("plain text").toString("base64url")}`),
    ).toBeNull();
  });

  it("rejects a document that is not UTF-8", async () => {
    expect(await decodeDocument(zlibFragment(new Uint8Array([0x48, 0xff, 0xfe])))).toBeNull();
  });

  it("accepts a document exactly at the size cap", async () => {
    const fragment = zlibFragment(new Uint8Array(MAX_DOCUMENT_BYTES).fill(0x61));
    expect(await decodeDocument(fragment)).toHaveLength(MAX_DOCUMENT_BYTES);
  });

  it("rejects a decompression bomb", async () => {
    expect(await decodeDocument(zlibFragment(new Uint8Array(64 * 1024 * 1024)))).toBeNull();
  });

  // Node's DecompressionStream inflates eagerly whatever the reader does, so
  // this checks the reader's half with endless output; the WebKit smoke suite
  // checks that a browser then stops consuming input.
  it("stops reading output once it passes the cap, and cancels the stream", async () => {
    const chunkBytes = 64 * 1024;
    let produced = 0;
    let cancelled = false;
    vi.stubGlobal(
      "DecompressionStream",
      class {
        writable = new WritableStream<BufferSource>();
        readable = new ReadableStream<Uint8Array>({
          pull(controller) {
            produced += chunkBytes;
            controller.enqueue(new Uint8Array(chunkBytes));
          },
          cancel() {
            cancelled = true;
          },
        });
      },
    );

    expect(await decodeDocument(await encodeDocument("tiny"))).toBeNull();
    expect(cancelled).toBe(true);
    expect(produced).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES + 2 * chunkBytes);
  });
});
