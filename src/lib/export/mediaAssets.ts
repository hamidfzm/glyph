import { mediaMimeType } from "@/lib/mediaExtensions";
import { basename } from "@/lib/paths";

/** A media file carried inside an export container (currently EPUB only). */
export interface PackagedMedia {
  /** Entry path inside the container. */
  zipPath: string;
  /** The same path as a URL, which is what the element and manifest reference. */
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
  const holder = el.hasAttribute("data-media-path")
    ? el
    : el.querySelector("source[data-media-path]");
  const path = holder?.getAttribute("data-media-path");
  const url = holder?.getAttribute("src");
  return path && url ? { path, url } : null;
}

// A poster image and its link are separate paragraphs on purpose: the PDF
// walker only embeds an image when it is a paragraph's sole child, and a linked
// image degrades to its alt text there.
function fallbackNodes(el: Element, doc: Document): Element[] {
  const local = localSource(el)?.path;
  const remote = el.getAttribute("src") ?? el.querySelector("source")?.getAttribute("src");
  const source = local ?? remote ?? "";
  const label = basename(source) || source;
  // Nothing nameable to link to: drop the element rather than emit an empty
  // anchor, which in an exported HTML file would point back at the document.
  if (!label) return [];
  // A local file is linked by name, so no absolute path leaks and the link
  // resolves for media that sat beside the document. A remote one keeps its
  // URL, the only place that copy can still be reached.
  const href = local ? label : source;
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

// Read a media file through the asset protocol, refusing anything over `budget`
// before its body is touched: a large recording must not be pulled into memory
// only to be discarded. A read that throws (an unreachable network share, a
// scheme the CSP refuses) is a fallback, never an aborted export.
async function readUnderBudget(url: string, budget: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length"));
    if (declared > budget) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.byteLength > budget ? null : bytes;
  } catch {
    return null;
  }
}

/**
 * Rewrite every media element in `clone` for export. `limit` is both the
 * per-file ceiling and the whole container's budget (0 disables embedding):
 * a book of several near-limit recordings would be assembled in memory and
 * shipped over IPC as one array, so the total has to be bounded too. Files that
 * fit are packaged and their elements rewritten to the in-container href;
 * everything else, remote sources included, degrades to poster plus link.
 */
export async function packageExportMedia(
  clone: HTMLElement,
  limit: number,
): Promise<PackagedMedia[]> {
  const doc = clone.ownerDocument;
  const packaged: PackagedMedia[] = [];
  // Two elements can play the same file; package the bytes once.
  const byPath = new Map<string, PackagedMedia>();
  let budget = limit;

  for (const el of Array.from(clone.querySelectorAll("video, audio"))) {
    const file = await packageOne(el, Math.min(limit, budget), byPath);
    if (!file) {
      el.replaceWith(...fallbackNodes(el, doc));
      continue;
    }
    if (!packaged.includes(file)) {
      packaged.push(file);
      budget -= file.bytes.byteLength;
    }
    el.setAttribute("src", file.href);
    el.removeAttribute("poster");
    // Child sources would still point at asset: URLs the container cannot
    // resolve, and the packaged file is the one the reader should play.
    for (const source of Array.from(el.querySelectorAll("source"))) source.remove();
  }

  // Every <source> still standing is an orphan, since a packaged element had
  // its children removed and a fallen-back one was replaced whole. It renders
  // nothing, but its asset: URL would carry an absolute local path into output.
  for (const el of Array.from(clone.querySelectorAll("source"))) el.remove();
  // The absolute path is an app-side detail; it never belongs in output.
  for (const el of Array.from(clone.querySelectorAll("[data-media-path]"))) {
    el.removeAttribute("data-media-path");
  }
  return packaged;
}

/** Package one element's file, reusing an earlier copy of the same path. */
async function packageOne(
  el: Element,
  budget: number,
  byPath: Map<string, PackagedMedia>,
): Promise<PackagedMedia | null> {
  if (budget <= 0) return null;
  const source = localSource(el);
  if (!source) return null;
  const seen = byPath.get(source.path);
  if (seen) return seen;
  const mediaType = mediaMimeType(source.path);
  if (!mediaType) return null;
  const bytes = await readUnderBudget(source.url, budget);
  if (!bytes) return null;

  const name = basename(source.path);
  const zipPath = `media/${byPath.size}-${name}`;
  // Spaces and `#` are ordinary in file names and would truncate or invalidate
  // the reference, so the URL form is encoded while the entry keeps the name.
  const file = {
    zipPath,
    href: `media/${byPath.size}-${encodeURIComponent(name)}`,
    bytes,
    mediaType,
  };
  byPath.set(source.path, file);
  return file;
}
