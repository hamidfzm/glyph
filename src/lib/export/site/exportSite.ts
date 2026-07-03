import { invoke } from "@tauri-apps/api/core";
import { collectStyles } from "@/lib/export/collectStyles";
import { buildHtmlDocument } from "@/lib/export/html";
import { deriveExportMeta } from "@/lib/export/meta";
import { restoreMermaidTheme } from "@/lib/export/rasterize";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { adaptMmdContent } from "@/lib/mmd";
import { basename } from "@/lib/paths";
import { buildIndexBodyHtml } from "./indexPage";
import { inlineMermaidSvgs } from "./mermaidInline";
import { buildNavHtml, type SitePage } from "./nav";
import { renderPageHtml } from "./renderPage";
import { rehypeSiteUrls } from "./rewriteUrls";
import { pageRelPath, relativeHref, relFromRoot } from "./sitePaths";

export interface ExportSiteOptions {
  /** Absolute workspace root to export. */
  root: string;
  /** Absolute output directory; created if missing. */
  outDir: string;
  /** Determinate progress: `done` pages written out of `total`. */
  onProgress?: (done: number, total: number) => void;
}

export interface ExportSiteResult {
  pages: number;
  assets: number;
}

const MERMAID_FENCE = /^(```|~~~)mermaid\b/m;

/** Join a site-relative POSIX path onto the output directory. */
function outPath(outDir: string, rel: string): string {
  return `${outDir.replace(/[/\\]+$/, "")}/${rel}`;
}

/** Directory of a site-relative path, or "" for a root-level file. */
function siteDir(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx < 0 ? "" : rel.slice(0, idx);
}

/**
 * Export a folder workspace as a browsable static site: one page per markdown
 * file (structure preserved, root README promoted to index.html), a shared
 * style.css collected from the live document, per-page nav, rewritten
 * wikilinks/relative links, copied image assets, and inline Mermaid SVGs.
 * Rendering is headless (no React mount), so every file exports with the same
 * fidelity regardless of what is open in the app.
 */
export async function exportSite({
  root,
  outDir,
  onProgress,
}: ExportSiteOptions): Promise<ExportSiteResult> {
  // `list_markdown_files` returns every openable document type; the site
  // renders the markdown family only (notebooks, canvases, and D2 sources
  // have their own renderers the headless pipeline can't reproduce).
  const listed = await invoke<string[]>("list_markdown_files", { path: root });
  const unordered = listed.filter(isMarkdownFile);
  if (unordered.length === 0) {
    throw new Error("The workspace contains no markdown files to export.");
  }
  // The root README claims index.html before anything else can collide with
  // it (e.g. Index.md on a case-insensitive filesystem).
  const readme = unordered.find((f) => pageRelPath(relFromRoot(root, f)) === "index.html");
  const files = readme ? [readme, ...unordered.filter((f) => f !== readme)] : unordered;

  // Pass 1: read everything up front. Nav on every page needs the full page
  // list with titles before the first page is written.
  const contents = new Map<string, string>();
  const pages = new Map<string, string>(); // abs md path -> site rel html path
  const sitePages: SitePage[] = [];
  // Output paths collide case-insensitively (Windows/macOS filesystems):
  // Index.md must not overwrite README.md's index.html, nor a.md A.md's page.
  const takenRels = new Set<string>();
  for (const file of files) {
    // .mmd files that sniff as Mermaid source render as a diagram, like the
    // viewer does.
    const content = adaptMmdContent(file, await invoke<string>("read_file", { path: file }));
    const wanted = pageRelPath(relFromRoot(root, file));
    let rel = wanted;
    for (let n = 1; takenRels.has(rel.toLowerCase()); n++) {
      rel = wanted.replace(/\.html$/, `-${n}.html`);
    }
    takenRels.add(rel.toLowerCase());
    contents.set(file, content);
    pages.set(file, rel);
    sitePages.push({ rel, title: deriveExportMeta(file, content).title });
  }
  const hasIndex = sitePages.some((p) => p.rel === "index.html");
  if (!hasIndex) sitePages.push({ rel: "index.html", title: basename(root) });

  const total = files.length + (hasIndex ? 0 : 1);
  onProgress?.(0, total);

  const dark = document.documentElement.classList.contains("dark");
  const assets = new Map<string, string>();
  const madeDirs = new Set<string>();
  const ensureDir = async (rel: string) => {
    const dir = siteDir(rel);
    if (madeDirs.has(dir)) return;
    madeDirs.add(dir);
    await invoke("create_dir_all", { path: dir === "" ? outDir : outPath(outDir, dir) });
  };

  const writePage = async (rel: string, bodyHtml: string, title: string) => {
    const html = buildHtmlDocument({
      bodyHtml,
      title,
      css: "",
      dark,
      stylesheetHref: relativeHref(rel, "style.css"),
      navHtml: buildNavHtml(sitePages, rel),
    });
    await ensureDir(rel);
    await invoke("write_file", { path: outPath(outDir, rel), content: html });
  };

  let done = 0;
  let copied = 0;
  let usedMermaid = false;
  try {
    for (const file of files) {
      const content = contents.get(file) ?? "";
      const pageRel = pages.get(file) ?? "index.html";
      let body = await renderPageHtml({
        content,
        filePath: file,
        workspaceFiles: files,
        extraRehype: [[rehypeSiteUrls, { filePath: file, pageRel, root, pages, assets }]],
      });
      if (MERMAID_FENCE.test(content)) {
        usedMermaid = true;
        body = await inlineMermaidSvgs(body);
      }
      await writePage(pageRel, body, deriveExportMeta(file, content).title);
      done++;
      onProgress?.(done, total);
    }

    if (!hasIndex) {
      await writePage("index.html", buildIndexBodyHtml(basename(root), sitePages), basename(root));
      done++;
      onProgress?.(done, total);
    }

    for (const [src, destRel] of assets) {
      await ensureDir(destRel);
      try {
        await invoke("copy_file", { src, dest: outPath(outDir, destRel) });
        copied++;
      } catch (err) {
        // A referenced image that is missing on disk renders nothing in the
        // app; the exported page gets the same broken reference instead of
        // the whole export failing on it.
        console.error(`Failed to copy asset ${src}:`, err);
      }
    }

    // Collected last so stylesheets loaded during rendering (KaTeX) are in.
    await ensureDir("style.css");
    await invoke("write_file", { path: outPath(outDir, "style.css"), content: collectStyles() });
  } finally {
    if (usedMermaid) await restoreMermaidTheme(dark);
  }

  return { pages: done, assets: copied };
}
