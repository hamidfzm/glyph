import { escapeXml } from "@/lib/export/escape";

/**
 * "On this page" outline for one generated page, the site's counterpart of
 * the app's Outline sidebar. Reads the headings straight from the rendered
 * body (they already carry rehype-slug ids) and links to them as fragments.
 * Returns null for pages with fewer than two headings, where an outline is
 * just noise.
 */
export function buildOutlineHtml(bodyHtml: string): string | null {
  const doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  const headings = Array.from(
    doc.body.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"),
  );
  if (headings.length < 2) return null;
  const items = headings.map((heading) => {
    const level = Number(heading.tagName.charAt(1));
    // textContent is typed nullable but is always a string on elements.
    const text = String(heading.textContent).trim();
    return `<li class="glyph-outline-l${level}"><a href="#${escapeXml(encodeURIComponent(heading.id))}">${escapeXml(text)}</a></li>`;
  });
  return `<nav class="glyph-site-outline" aria-label="Outline"><ul>${items.join("")}</ul></nav>`;
}
