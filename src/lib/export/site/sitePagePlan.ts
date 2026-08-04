import { invoke } from "@tauri-apps/api/core";
import { deriveExportMeta } from "@/lib/export/meta";
import { adaptMmdContent } from "@/lib/mmd";
import type { SitePage } from "./nav";
import { indexSourcePriority, pageRelPath, relFromRoot } from "./sitePaths";

export interface SitePagePlan {
  /** Source files in output order; the index page first when one was promoted. */
  files: string[];
  /** Everything the render pass needs per page, read up front. */
  jobs: Array<{ file: string; content: string; rel: string }>;
  /** Absolute markdown path to site-relative html path, for link rewriting. */
  pages: Map<string, string>;
  /** Nav entries, which every page needs before the first one is written. */
  sitePages: SitePage[];
  hasIndex: boolean;
}

/**
 * Decide what the site contains before anything is rendered: which file owns
 * index.html, what each page's output path is, and the nav list.
 */
export async function planSitePages(
  root: string,
  unordered: string[],
  fallbackTitle: string,
): Promise<SitePagePlan> {
  // One root file owns the site's index.html: a root index.* first, a root
  // README.* as fallback. It goes first so nothing can collide with
  // index.html before it claims the name; a README that lost the promotion
  // exports as a normal README.html page.
  const indexSource = unordered.reduce<string | null>((best, f) => {
    const priority = indexSourcePriority(relFromRoot(root, f));
    if (priority === 0) return best;
    return best !== null && indexSourcePriority(relFromRoot(root, best)) >= priority ? best : f;
  }, null);
  const files =
    indexSource !== null ? [indexSource, ...unordered.filter((f) => f !== indexSource)] : unordered;

  // Pass 1: read everything up front. Nav on every page needs the full page
  // list with titles before the first page is written.
  const jobs: Array<{ file: string; content: string; rel: string }> = [];
  const pages = new Map<string, string>(); // abs md path -> site rel html path
  const sitePages: SitePage[] = [];
  // Output paths collide case-insensitively (Windows/macOS filesystems):
  // a.md must not overwrite A.md's page, nor Cooking.mmd Cooking.md's.
  const takenRels = new Set<string>();
  for (const file of files) {
    // .mmd files that sniff as Mermaid source render as a diagram, like the
    // viewer does.
    const content = adaptMmdContent(file, await invoke<string>("read_file", { path: file }));
    const wanted = file === indexSource ? "index.html" : pageRelPath(relFromRoot(root, file));
    let rel = wanted;
    for (let n = 1; takenRels.has(rel.toLowerCase()); n++) {
      rel = wanted.replace(/\.html$/, `-${n}.html`);
    }
    takenRels.add(rel.toLowerCase());
    jobs.push({ file, content, rel });
    pages.set(file, rel);
    sitePages.push({ rel, title: deriveExportMeta(file, content).title });
  }
  const hasIndex = sitePages.some((p) => p.rel === "index.html");
  if (!hasIndex) sitePages.push({ rel: "index.html", title: fallbackTitle });

  return { files, jobs, pages, sitePages, hasIndex };
}
