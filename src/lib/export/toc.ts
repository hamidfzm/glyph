import type { TocEntry } from "@/hooks/useTableOfContents";

export const TOC_CLASS = "print-toc";

/**
 * Build a `<nav class="print-toc">` table-of-contents element from heading
 * entries. Shared by the print path (`usePrint`) and the HTML/EPUB exporters so
 * both produce an identical, anchor-linked contents list.
 */
export function buildTocElement(entries: TocEntry[]): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = TOC_CLASS;
  nav.setAttribute("aria-label", "Table of contents");

  const heading = document.createElement("h2");
  heading.textContent = "Contents";
  nav.appendChild(heading);

  const list = document.createElement("ul");
  for (const entry of entries) {
    const li = document.createElement("li");
    li.style.paddingLeft = `${(entry.level - 1) * 16}px`;
    const a = document.createElement("a");
    a.href = `#${entry.id}`;
    a.textContent = entry.text;
    li.appendChild(a);
    list.appendChild(li);
  }
  nav.appendChild(list);
  return nav;
}
