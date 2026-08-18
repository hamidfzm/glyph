import { mediaMimeType } from "@/lib/mediaExtensions";
import { basename } from "@/lib/paths";

/** A media file carried inside an export container (currently EPUB only). */
export interface PackagedMedia {
  /** Path inside the container, also the rewritten element `src`. */
  href: string;
  bytes: Uint8Array;
  mediaType: string;
}

// Exports never inline media as a data URI and never write files beside the
// export target, so a player only survives where the container can hold the
// bytes. Everywhere else the element degrades to its poster frame plus a link
// named after the file, which is what DOCX, PDF, and plain HTML can represent.

// A poster image and its link are separate paragraphs on purpose: the PDF
// walker only embeds an image when it is a paragraph's sole child, and a linked
// image degrades to its alt text there.
function fallbackNodes(el: Element, doc: Document): Element[] {
  const source = el.getAttribute("data-media-path") ?? el.getAttribute("src") ?? "";
  const label = basename(source) || source;
  const nodes: Element[] = [];

  const poster = el.getAttribute("poster");
  if (poster) {
    const frame = doc.createElement("p");
    frame.className = "markdown-media-fallback";
    const img = doc.createElement("img");
    img.setAttribute("src", poster);
    img.setAttribute("alt", label);
    frame.appendChild(img);
    nodes.push(frame);
  }

  const line = doc.createElement("p");
  line.className = "markdown-media-fallback";
  const link = doc.createElement("a");
  // Relative to the exported document, so the link resolves once the reader
  // keeps the media beside it and no absolute local path leaks into the output.
  link.setAttribute("href", label);
  link.textContent = label;
  line.appendChild(link);
  nodes.push(line);
  return nodes;
}

/** The playable source of a media element: its own src, else its first source child. */
function localPathOf(el: Element): string | null {
  const own = el.getAttribute("data-media-path");
  if (own) return own;
  return el.querySelector("source[data-media-path]")?.getAttribute("data-media-path") ?? null;
}

function assetUrlOf(el: Element): string | null {
  if (el.getAttribute("data-media-path")) return el.getAttribute("src");
  return el.querySelector("source[data-media-path]")?.getAttribute("src") ?? null;
}

// Read a media file through the asset protocol, refusing anything over `limit`
// before its body is touched: a large recording must not be pulled into memory
// only to be discarded.
async function readUnderLimit(url: string, limit: number): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length"));
  if (declared > limit) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength > limit ? null : bytes;
}

/**
 * Rewrite every media element in `clone` for export. With `limit` bytes of
 * embedding budget (0 disables it), a local file under the limit is packaged
 * and its element rewritten to the in-container href; everything else, remote
 * sources included, degrades to the poster plus link fallback.
 */
export async function packageExportMedia(
  clone: HTMLElement,
  limit: number,
): Promise<PackagedMedia[]> {
  const doc = clone.ownerDocument;
  const packaged: PackagedMedia[] = [];

  for (const el of Array.from(clone.querySelectorAll("video, audio"))) {
    const path = localPathOf(el);
    const url = assetUrlOf(el);
    const mediaType = path ? mediaMimeType(path) : undefined;
    const bytes = limit > 0 && path && url && mediaType ? await readUnderLimit(url, limit) : null;

    if (!bytes || !path || !mediaType) {
      el.replaceWith(...fallbackNodes(el, doc));
      continue;
    }

    const href = `media/${packaged.length}-${basename(path)}`;
    packaged.push({ href, bytes, mediaType });
    el.setAttribute("src", href);
    el.removeAttribute("poster");
    // Child sources would still point at asset: URLs the container cannot
    // resolve, and the packaged file is the one the reader should play.
    for (const source of Array.from(el.querySelectorAll("source"))) source.remove();
  }

  // The absolute paths are an app-side detail; they never belong in output.
  for (const el of Array.from(clone.querySelectorAll("[data-media-path], [data-poster-path]"))) {
    el.removeAttribute("data-media-path");
    el.removeAttribute("data-poster-path");
  }
  return packaged;
}
