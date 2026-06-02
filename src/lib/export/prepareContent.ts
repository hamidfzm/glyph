import type { TocEntry } from "@/hooks/useTableOfContents";
import { buildTocElement } from "./toc";

export interface PrepareOptions {
  entries: TocEntry[];
  includeToc: boolean;
  // Overridable for tests; defaults to the live document.
  doc?: Document;
}

// Elements that exist only for interactive use in the app and should never
// appear in an exported document.
const STRIP_SELECTOR = ".code-copy-button, [data-export-ignore]";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Inline an <img> as a base64 data URI so the export is portable and offline.
// Already-inlined (data:) images are left alone; a fetch failure leaves the
// original src untouched rather than dropping the image.
async function embedImage(img: HTMLImageElement): Promise<void> {
  const src = img.getAttribute("src");
  if (!src || src.startsWith("data:")) return;
  try {
    const res = await fetch(src);
    if (!res.ok) return;
    img.setAttribute("src", await blobToDataUrl(await res.blob()));
  } catch {
    // Leave the original src; the reader may still resolve it.
  }
}

/**
 * Clone the rendered `.markdown-body`, strip app-only UI, inline images, and
 * optionally prepend a table of contents. Returns the cleaned inner HTML, or
 * `null` when there is no rendered body to export.
 *
 * Reusing the live DOM (rather than re-parsing markdown) means KaTeX math,
 * highlighted code, GFM tables, alerts, and Mermaid SVGs come through exactly
 * as the user sees them.
 */
export async function prepareContent({
  entries,
  includeToc,
  doc = document,
}: PrepareOptions): Promise<string | null> {
  const body = doc.querySelector<HTMLElement>(".markdown-body");
  if (!body) return null;

  const clone = body.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll(STRIP_SELECTOR))) {
    el.remove();
  }

  await Promise.all(Array.from(clone.querySelectorAll("img")).map(embedImage));

  if (includeToc && entries.length > 0) {
    clone.insertBefore(buildTocElement(entries), clone.firstChild);
  }

  return clone.innerHTML;
}
