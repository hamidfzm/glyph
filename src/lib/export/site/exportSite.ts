import { invoke } from "@tauri-apps/api/core";
import { collectStyles } from "@/lib/export/collectStyles";
import { buildHtmlDocument, siteChromeCss, siteChromeScript } from "@/lib/export/html";
import { deriveExportMeta } from "@/lib/export/meta";
import { restoreMermaidTheme } from "@/lib/export/rasterize";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { adaptMmdContent } from "@/lib/mmd";
import { basename } from "@/lib/paths";
import { buildIndexBodyHtml } from "./indexPage";
import { inlineMermaidSvgs } from "./mermaidInline";
import { buildNavHtml, type SitePage } from "./nav";
import { buildOutlineHtml } from "./outline";
import { buildPageMetaHtml, pageDescription, pageDocumentTitle } from "./pageMeta";
import { renderPageHtml } from "./renderPage";
import { rehypeSiteUrls } from "./rewriteUrls";
import { parseSiteConfig, resolveConfigAsset, robotsTxt, SITE_CONFIG_FILENAME } from "./siteConfig";
import { indexSourcePriority, pageRelPath, relativeHref, relFromRoot } from "./sitePaths";

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
 * file (structure preserved; the root index.*, else the root README.*, owns
 * index.html), a shared style.css collected from the live document, per-page
 * nav and outline, rewritten wikilinks/relative links, copied image assets,
 * and inline Mermaid SVGs. Rendering is headless (no React mount), so every
 * file exports with the same fidelity regardless of what is open in the app.
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

  // Site-wide metadata: optional glyph-site.json at the root; absence is
  // fine, a present-but-invalid file fails the export loudly. The read error
  // string doesn't distinguish "missing" from "unreadable" portably, so any
  // read failure falls back to defaults; parse errors still throw.
  const rawConfig = await invoke<string>("read_file", {
    path: `${root}/${SITE_CONFIG_FILENAME}`,
  }).catch(() => null);
  const config = parseSiteConfig(rawConfig ?? null, basename(root));

  const fileExists = (path: string) =>
    invoke("get_file_metadata", { path }).then(
      () => true,
      () => false,
    );
  // A configured favicon/social image that doesn't exist is a config error,
  // not a broken <link> discovered after publishing; resolveConfigAsset also
  // clamps the path to the workspace, since the config may come from an
  // untrusted repo. Without a config, a conventional root favicon is picked
  // up automatically.
  let faviconAbs: string | null = null;
  let faviconRel: string | null = null;
  if (config.favicon !== null) {
    const resolved = resolveConfigAsset(root, config.favicon, "favicon");
    if (!(await fileExists(resolved.abs))) {
      throw new Error(
        `${SITE_CONFIG_FILENAME}: favicon not found in the workspace: ${config.favicon}`,
      );
    }
    faviconAbs = resolved.abs;
    faviconRel = resolved.siteRel;
  } else {
    for (const candidate of ["favicon.ico", "favicon.png", "favicon.svg"]) {
      if (await fileExists(`${root}/${candidate}`)) {
        faviconAbs = `${root}/${candidate}`;
        faviconRel = candidate;
        break;
      }
    }
  }
  let socialImageAbs: string | null = null;
  let socialImageRel: string | null = null;
  if (config.socialImage !== null) {
    const resolved = resolveConfigAsset(root, config.socialImage, "socialImage");
    if (!(await fileExists(resolved.abs))) {
      throw new Error(
        `${SITE_CONFIG_FILENAME}: socialImage not found in the workspace: ${config.socialImage}`,
      );
    }
    socialImageAbs = resolved.abs;
    socialImageRel = resolved.siteRel;
  }
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
  if (!hasIndex) sitePages.push({ rel: "index.html", title: config.title });

  const total = files.length + (hasIndex ? 0 : 1);
  onProgress?.(0, total);

  const dark = document.documentElement.classList.contains("dark");
  const assets = new Map<string, string>();
  // The favicon and social image ship with the site, mirroring their
  // workspace location; the shared asset-copy pass below picks them up.
  if (faviconAbs !== null && faviconRel !== null) assets.set(faviconAbs, faviconRel);
  if (socialImageAbs !== null && socialImageRel !== null) {
    assets.set(socialImageAbs, socialImageRel);
  }
  const madeDirs = new Set<string>();
  const ensureDir = async (rel: string) => {
    const dir = siteDir(rel);
    if (madeDirs.has(dir)) return;
    madeDirs.add(dir);
    await invoke("create_dir_all", { path: dir === "" ? outDir : outPath(outDir, dir) });
  };

  const writePage = async (
    rel: string,
    bodyHtml: string,
    title: string,
    description: string | null,
  ) => {
    const isIndex = rel === "index.html";
    const html = buildHtmlDocument({
      bodyHtml,
      title: pageDocumentTitle(title, config.title, isIndex),
      css: "",
      dark,
      // Pages share one stylesheet and one theme script (all pages carry the
      // same chrome); only the body markup is per-page.
      stylesheetHref: relativeHref(rel, "style.css"),
      scriptHref: relativeHref(rel, "site.js"),
      navHtml: buildNavHtml(sitePages, rel),
      outlineHtml: buildOutlineHtml(bodyHtml),
      headHtml: buildPageMetaHtml({
        siteTitle: config.title,
        pageTitle: title,
        isIndex,
        description,
        pageRel: rel,
        baseUrl: config.baseUrl,
        faviconRel,
        socialImageRel,
      }),
    });
    await ensureDir(rel);
    await invoke("write_file", { path: outPath(outDir, rel), content: html });
  };

  let done = 0;
  let copied = 0;
  let usedMermaid = false;
  try {
    for (const { file, content, rel: pageRel } of jobs) {
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
      await writePage(
        pageRel,
        body,
        deriveExportMeta(file, content).title,
        pageDescription(content, config.description),
      );
      done++;
      onProgress?.(done, total);
    }

    if (!hasIndex) {
      await writePage(
        "index.html",
        buildIndexBodyHtml(config.title, sitePages),
        config.title,
        pageDescription("", config.description),
      );
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
    // The chrome CSS and theme script live in shared files rather than being
    // repeated inline in every page.
    await ensureDir("style.css");
    await invoke("write_file", {
      path: outPath(outDir, "style.css"),
      content: `${collectStyles()}\n${siteChromeCss()}`,
    });
    await invoke("write_file", { path: outPath(outDir, "site.js"), content: siteChromeScript() });
    if (config.robots !== null) {
      await invoke("write_file", {
        path: outPath(outDir, "robots.txt"),
        content: robotsTxt(config.robots),
      });
    }
  } finally {
    if (usedMermaid) await restoreMermaidTheme(dark);
  }

  return { pages: done, assets: copied };
}
