import { escapeXml } from "@/lib/export/escape";
import { encodeHref, relativeHref } from "./sitePaths";

/** One generated page of the exported site. */
export interface SitePage {
  /** Site-relative path of the generated page ("guide/intro.html"). */
  rel: string;
  /** Human title (frontmatter title or file basename). */
  title: string;
}

interface TreeDir {
  dirs: Map<string, TreeDir>;
  pages: SitePage[];
}

function newDir(): TreeDir {
  return { dirs: new Map(), pages: [] };
}

function insert(root: TreeDir, page: SitePage): void {
  const segs = page.rel.split("/");
  let dir = root;
  for (const seg of segs.slice(0, -1)) {
    let next = dir.dirs.get(seg);
    if (!next) {
      next = newDir();
      dir.dirs.set(seg, next);
    }
    dir = next;
  }
  dir.pages.push(page);
}

function renderDir(dir: TreeDir, currentRel: string): string {
  const items: string[] = [];
  // Folders first, then pages, each alphabetical; index.html leads its folder.
  for (const [name, sub] of [...dir.dirs].sort(([a], [b]) => a.localeCompare(b))) {
    items.push(
      `<li><details open><summary>${escapeXml(name)}</summary>${renderDir(sub, currentRel)}</details></li>`,
    );
  }
  const pages = [...dir.pages].sort((a, b) =>
    a.rel === "index.html" ? -1 : b.rel === "index.html" ? 1 : a.title.localeCompare(b.title),
  );
  for (const page of pages) {
    const href = encodeHref(relativeHref(currentRel, page.rel));
    const current = page.rel === currentRel ? ' aria-current="page"' : "";
    items.push(`<li><a href="${escapeXml(href)}"${current}>${escapeXml(page.title)}</a></li>`);
  }
  return `<ul>${items.join("")}</ul>`;
}

/**
 * Cross-page navigation tree included on every generated page. Folders are
 * native `<details>` disclosures (open by default, no JS); the current page is
 * marked with `aria-current` for styling and assistive tech.
 */
export function buildNavHtml(pages: readonly SitePage[], currentRel: string): string {
  const root = newDir();
  for (const page of pages) {
    insert(root, page);
  }
  return `<nav class="glyph-site-nav" aria-label="Site">${renderDir(root, currentRel)}</nav>`;
}
