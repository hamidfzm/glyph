import { escapeXml } from "@/lib/export/escape";
import type { SitePage } from "./nav";
import { encodeHref } from "./sitePaths";

/**
 * Body HTML for the generated index page, used when the workspace has no root
 * README to promote to index.html: the workspace name plus a flat list of
 * every page (the per-folder structure is already in the nav sidebar).
 */
export function buildIndexBodyHtml(workspaceName: string, pages: readonly SitePage[]): string {
  const items = [...pages]
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map(
      (page) =>
        `<li><a href="${escapeXml(encodeHref(page.rel))}">${escapeXml(page.title)}</a></li>`,
    );
  return `<h1>${escapeXml(workspaceName)}</h1>\n<ul>${items.join("")}</ul>`;
}
