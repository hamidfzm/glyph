import { scrollToElement } from "@/lib/scrollToHeading";

const EXTERNAL = /^(https?:)?\/\//i;

// The URL fragment carries the document, so no link in it may navigate this
// page. Mermaid's SVG links carry `xlink:href`.
export function handleDocumentClick(event: MouseEvent, root: HTMLElement): void {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a");
  if (!link) return;
  const href = link.getAttribute("href") || link.getAttribute("xlink:href") || "";
  if (/^mailto:/i.test(href)) return;
  event.preventDefault();
  if (href.startsWith("#")) {
    scrollToAnchor(root, href.slice(1));
    return;
  }
  if (EXTERNAL.test(href)) openInNewTab(href);
}

function openInNewTab(href: string): void {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    // `https://` alone passes the pattern but is no URL.
    return;
  }
  window.open(url.href, "_blank", "noopener,noreferrer");
}

// Looked up inside the document only: a heading slugged `preview` would
// otherwise find the page's own root.
function scrollToAnchor(root: HTMLElement, encodedId: string): void {
  const id = decodeId(encodedId);
  const target = Array.from(root.querySelectorAll<HTMLElement>("[id]")).find(
    (element) => element.id === id,
  );
  if (target) scrollToElement(target);
}

// Link targets are percent-encoded while heading ids keep their characters.
function decodeId(encodedId: string): string {
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
}
