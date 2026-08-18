import type { TocEntry } from "@/hooks/useTableOfContents";
import { type PackagedMedia, packageExportMedia } from "./mediaAssets";
import { inlineCodeColors, preparePdfRichContent, rasterizeRtlBlocks } from "./preparePdfContent";
import { buildTocElement } from "./toc";

export interface PrepareOptions {
  entries: TocEntry[];
  includeToc: boolean;
  // Overridable for tests; defaults to the live document.
  doc?: Document;
  // PDF export needs extra work the vector walker can't do itself: inline the
  // rendered syntax-highlight colors onto code spans, rasterize block math to
  // an embedded image, and re-render diagrams light as inline SVG so pdfmake
  // embeds them as vectors.
  pdf?: boolean;
  // Bytes of media a container-backed target (EPUB) may package. 0, the
  // default, degrades every media element to its poster plus link.
  mediaLimit?: number;
}

export interface PreparedContent {
  // Cleaned inner HTML of the rendered body.
  html: string;
  // The wrapper class to reuse so bundled styles apply (markdown vs notebook).
  bodyClass: "markdown-body" | "notebook-body";
  // Media files the caller must write into its container, keyed by the href
  // the rewritten elements now point at. Empty unless `mediaLimit` allowed it.
  media: PackagedMedia[];
}

// Elements that exist only for interactive use in the app and should never
// appear in an exported document. Every rendered `<button>` is a tool (copy
// code, heading anchor, note-embed "open source"), so the tag is stripped
// wholesale; raw markdown can't produce one (button is not in the sanitize
// allowlist), so this only removes our own affordances, never document content.
// `[data-export-ignore]` covers non-button opt-outs.
const STRIP_SELECTOR = "button, [data-export-ignore]";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Inline an image asset as a base64 data URI so the export is portable and
// offline. Already-inlined (data:) values are left alone; a fetch failure
// leaves the original untouched rather than dropping the image.
async function embedAsset(el: Element, attr: "src" | "href"): Promise<void> {
  const value = el.getAttribute(attr);
  if (!value || value.startsWith("data:")) return;
  try {
    const res = await fetch(value);
    if (!res.ok) return;
    el.setAttribute(attr, await blobToDataUrl(await res.blob()));
  } catch {
    // Leave the original; the reader may still resolve it.
  }
}

/**
 * Clone the rendered document body (markdown or notebook), strip app-only UI,
 * make task checkboxes non-interactive, inline images, and optionally prepend a
 * table of contents. Returns the cleaned inner HTML plus its wrapper class, or
 * `null` when there is no rendered body to export.
 *
 * Reusing the live DOM (rather than re-parsing markdown) means KaTeX math,
 * highlighted code, GFM tables, alerts, Mermaid SVGs, and notebook cells come
 * through exactly as the user sees them.
 */
export async function prepareContent({
  entries,
  includeToc,
  doc = document,
  pdf = false,
  mediaLimit = 0,
}: PrepareOptions): Promise<PreparedContent | null> {
  const body = doc.querySelector<HTMLElement>(".markdown-body, .notebook-body");
  if (!body) return null;
  const bodyClass = body.classList.contains("notebook-body") ? "notebook-body" : "markdown-body";

  const clone = body.cloneNode(true) as HTMLElement;
  if (pdf) {
    inlineCodeColors(body, clone);
    await preparePdfRichContent(body, clone);
    // After the math/diagram pass: both passes match live and clone nodes by
    // querySelectorAll index, and this one replaces whole blocks that may
    // contain the elements the first pass looks for.
    await rasterizeRtlBlocks(body, clone);
  }
  for (const el of Array.from(clone.querySelectorAll(STRIP_SELECTOR))) {
    el.remove();
  }

  // Task-list checkboxes are interactive in the app; an exported document must
  // show their state without being togglable.
  for (const checkbox of Array.from(clone.querySelectorAll('input[type="checkbox"]'))) {
    checkbox.setAttribute("disabled", "");
  }

  // Ahead of the link and image passes: a media element that cannot be packaged
  // degrades to a poster <img> plus an <a>, which those passes then treat like
  // any other image and link.
  const media = await packageExportMedia(clone, mediaLimit);

  // External links should open in a new tab/window from the exported file.
  // The `a[href]` selector guarantees the attribute is present.
  for (const anchor of Array.from(clone.querySelectorAll("a[href]"))) {
    if (/^https?:/i.test(anchor.getAttribute("href")!)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }

  await Promise.all([
    ...Array.from(clone.querySelectorAll("img")).map((el) => embedAsset(el, "src")),
    // SVG <image> icons carry asset: URLs from the live DOM; inline them too
    // or exported files leak absolute local paths that resolve nowhere.
    ...Array.from(clone.querySelectorAll("image")).map((el) => embedAsset(el, "href")),
  ]);

  if (includeToc && entries.length > 0) {
    clone.insertBefore(buildTocElement(entries), clone.firstChild);
  }

  return { html: clone.innerHTML, bodyClass, media };
}
