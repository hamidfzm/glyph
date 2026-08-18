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

/** The playable local source: the element's own, else its first source child. */
function localSource(el: Element): { path: string; url: string } | null {
  const own = el.getAttribute("data-media-path");
  if (own) return { path: own, url: el.getAttribute("src") ?? "" };
  const child = el.querySelector("source[data-media-path]");
  const path = child?.getAttribute("data-media-path");
  if (!path) return null;
  return { path, url: child?.getAttribute("src") ?? "" };
}

// A poster image and its link are separate paragraphs on purpose: the PDF
// walker only embeds an image when it is a paragraph's sole child, and a linked
// image degrades to its alt text there.
function fallbackNodes(el: Element, doc: Document): Element[] {
  const local = localSource(el)?.path;
  const remote = el.getAttribute("src") ?? el.querySelector("source")?.getAttribute("src") ?? "";
  const label = basename(local ?? remote) || remote;
  // A local file is linked by name, so no absolute path leaks and the link
  // resolves once the reader keeps the media beside the document. A remote one
  // keeps its URL, which is the only place that copy can still be reached.
  const href = local ? label : remote;
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
  link.setAttribute("href", href);
  link.textContent = label;
  line.appendChild(link);
  nodes.push(line);
  return nodes;
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

/** The packageable payload of one element, or null when it has to fall back. */
async function readPackageable(
  el: Element,
  limit: number,
): Promise<{ bytes: Uint8Array; mediaType: string; name: string } | null> {
  if (limit <= 0) return null;
  const source = localSource(el);
  if (!source) return null;
  const mediaType = mediaMimeType(source.path);
  if (!mediaType) return null;
  const bytes = await readUnderLimit(source.url, limit);
  return bytes ? { bytes, mediaType, name: basename(source.path) } : null;
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
    const file = await readPackageable(el, limit);
    if (!file) {
      el.replaceWith(...fallbackNodes(el, doc));
      continue;
    }

    const href = `media/${packaged.length}-${file.name}`;
    packaged.push({ href, bytes: file.bytes, mediaType: file.mediaType });
    el.setAttribute("src", href);
    el.removeAttribute("poster");
    // Child sources would still point at asset: URLs the container cannot
    // resolve, and the packaged file is the one the reader should play.
    for (const source of Array.from(el.querySelectorAll("source"))) source.remove();
  }

  // The absolute path is an app-side detail; it never belongs in output.
  for (const el of Array.from(clone.querySelectorAll("[data-media-path]"))) {
    el.removeAttribute("data-media-path");
  }
  return packaged;
}
