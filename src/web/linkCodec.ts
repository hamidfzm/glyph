import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import { chunked, collect } from "@/lib/byteStreams";
import { decodeUtf8, MAX_DOCUMENT_BYTES } from "./documentText";

// The fragment's format version, so a later encoding can coexist with old links.
const PREFIX = "v1.";
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Chrome refuses longer URLs, so the viewer neither makes nor reads longer links. */
export const MAX_LINK_LENGTH = 2 * 1024 * 1024;

export async function encodeDocument(content: string): Promise<string> {
  const compressed = await collect(
    chunked(new TextEncoder().encode(content)).pipeThrough(new CompressionStream("deflate-raw")),
    Number.POSITIVE_INFINITY,
  );
  return PREFIX + toBase64Url(compressed);
}

/** The document a fragment carries, or null for anything malformed or over the size cap. */
export async function decodeDocument(fragment: string): Promise<string | null> {
  if (!fragment.startsWith(PREFIX) || fragment.length > MAX_LINK_LENGTH) return null;
  const compressed = fromBase64Url(fragment.slice(PREFIX.length));
  if (!compressed) return null;
  try {
    const bytes = await collect(
      chunked(compressed).pipeThrough(new DecompressionStream("deflate-raw")),
      MAX_DOCUMENT_BYTES,
    );
    return decodeUtf8(bytes);
  } catch {
    // Over the cap, corrupt, truncated, or trailing data after the deflate stream.
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text)) return null;
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    return base64ToBytes(base64 + padding);
  } catch {
    return null;
  }
}
