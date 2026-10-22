import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { pathStem } from "@/lib/paths";
import { staticRenderers } from "@/lib/plugins/staticRenderers";
import type { MarkdownPlugin } from "@/lib/plugins/types";
import { exportSite, type PruneReport } from "./exportSite";

// happy-dom cannot run DOMPurify faithfully; the sanitize wiring is covered
// in staticInline.test.ts.
vi.mock("dompurify", () => ({ default: { sanitize: (markup: string) => markup } }));

interface FakeFs {
  writes: Map<string, string>;
  dirs: string[];
  copies: Array<{ src: string; dest: string }>;
  /** Site-relative paths handed to the pruner as written, one entry per export. */
  pruned: string[][];
  /** Those handed to it as not replaced, one entry per export. */
  unreplaced: string[][];
}

function mockFs(
  files: Record<string, string>,
  pruned: PruneReport = { removed: 0, error: null },
): FakeFs {
  const fs: FakeFs = { writes: new Map(), dirs: [], copies: [], pruned: [], unreplaced: [] };
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, string>;
    switch (cmd) {
      case "list_markdown_files":
        return Promise.resolve({
          files: Object.keys(files),
          status: { truncated: false, reason: null, limit: null },
        });
      case "read_file":
        return Promise.resolve(files[a.path]);
      case "write_file":
        fs.writes.set(a.path, a.content);
        return Promise.resolve(undefined);
      case "create_dir_all":
        fs.dirs.push(a.path);
        return Promise.resolve(undefined);
      case "copy_file":
        fs.copies.push({ src: a.src, dest: a.dest });
        return Promise.resolve(true);
      case "prune_export_dir": {
        const lists = args as { written: string[]; unreplaced: string[] };
        fs.pruned.push(lists.written);
        fs.unreplaced.push(lists.unreplaced);
        return Promise.resolve(pruned);
      }
      case "vault_refresh":
        return Promise.resolve(undefined);
      case "vault_resolve": {
        // Stands in for the index: a target names a file by its stem.
        const { targets } = args as { targets: string[] };
        const paths = Object.keys(files);
        return Promise.resolve(
          targets.map((t) => paths.find((p) => pathStem(p) === t.split("#")[0]) ?? null),
        );
      }
      case "check_path_exists":
        return a.path in files
          ? Promise.resolve(undefined)
          : Promise.reject(new Error("not found"));
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
  return fs;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("exportSite", () => {
  it("renders plugin remark and rehype contributions into the pages", async () => {
    interface Node {
      type: string;
      value?: string;
      children?: Node[];
    }
    // remark: upper-case text; rehype: append a footer element to the tree.
    const shout = () => (tree: Node) => {
      const visit = (node: Node) => {
        if (node.type === "text" && node.value) node.value = node.value.toUpperCase();
        for (const child of node.children ?? []) visit(child);
      };
      visit(tree);
    };
    const stamp = () => (tree: { children: unknown[] }) => {
      tree.children.push({
        type: "element",
        tagName: "footer",
        properties: { className: ["plugin-stamp"] },
        children: [{ type: "text", value: "stamped" }],
      });
    };
    const fs = mockFs({ "/ws/notes.md": "plugin text" });
    await exportSite({
      root: "/ws",
      outDir: "/out",
      remarkPlugins: [shout as MarkdownPlugin],
      rehypePlugins: [stamp as MarkdownPlugin],
    });
    const page = fs.writes.get("/out/notes.html") ?? "";
    expect(page).toContain("PLUGIN TEXT");
    expect(page).toContain('<footer class="plugin-stamp">stamped</footer>');
  });

  it("writes one page per file, promotes README, and emits shared style.css", async () => {
    const fs = mockFs({
      "/ws/README.md": "# Home",
      "/ws/guide/intro.md": "# Intro\n\nSee [[README]]",
    });
    const progress: Array<[number, number]> = [];
    const result = await exportSite({
      root: "/ws",
      outDir: "/out",
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(result).toEqual({
      pages: 2,
      assets: 0,
      removed: 0,
      failedAssets: [],
      pruneError: null,
    });
    expect([...fs.writes.keys()].sort()).toEqual([
      "/out/guide/intro.html",
      "/out/index.html",
      "/out/site.js",
      "/out/style.css",
    ]);
    expect(progress[0]).toEqual([0, 2]);
    expect(progress.at(-1)).toEqual([2, 2]);

    const intro = fs.writes.get("/out/guide/intro.html") ?? "";
    expect(intro).toContain('<link rel="stylesheet" href="../style.css">');
    expect(intro).toContain('<script src="../site.js"></script>');
    expect(intro).toContain('class="glyph-site-nav"');
    expect(intro).toContain('href="../index.html"');
    expect(fs.dirs).toContain("/out/guide");

    // Chrome shared by every page lives once in the site files, not inline.
    expect(intro).not.toContain("<style>");
    expect(fs.writes.get("/out/style.css")).toContain(".glyph-site {");
    expect(fs.writes.get("/out/site.js")).toContain("glyph-export-theme");
  });

  it("writes the lightbox labels in the app's UI language", async () => {
    const fs = mockFs({ "/ws/notes.md": "# N" });
    await i18n.changeLanguage("de");
    try {
      await exportSite({ root: "/ws", outDir: "/out" });
    } finally {
      await i18n.changeLanguage("en");
    }
    const deClose = i18n.getFixedT("de")("common:lightbox.close");
    expect(deClose).not.toBe(i18n.t("common:lightbox.close"));
    expect(fs.writes.get("/out/site.js")).toContain(JSON.stringify(deClose));
  });

  it("generates an index page when the workspace has no root README", async () => {
    const fs = mockFs({ "/ws/notes.md": "# Notes" });
    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.pages).toBe(2);
    const index = fs.writes.get("/out/index.html") ?? "";
    expect(index).toContain("<h1>ws</h1>");
    expect(index).toContain('href="notes.html"');
  });

  it("copies referenced images into the output tree", async () => {
    const fs = mockFs({ "/ws/notes.md": "![shot](./img/shot.png)" });
    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.assets).toBe(1);
    expect(fs.copies).toEqual([{ src: "/ws/img/shot.png", dest: "/out/img/shot.png" }]);
  });

  it("copies nothing hidden or above the workspace, however a page refers to it", async () => {
    const fs = mockFs({
      "/ws/notes.md":
        "![e](.env) [c](.git/config) ![d](../private/diagram.png) ![ok](images/x.png)",
      "/ws/.env": "SECRET=1",
      "/ws/.git/config": "[remote]",
      "/private/diagram.png": "<binary>",
      "/ws/images/x.png": "<binary>",
    });
    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.assets).toBe(1);
    expect(fs.copies).toEqual([{ src: "/ws/images/x.png", dest: "/out/images/x.png" }]);
    expect(fs.pruned[0]).not.toContain(".env");
    expect(fs.pruned[0]).not.toContain(".git/config");
  });

  it("copies a linked file into the output tree so the link resolves", async () => {
    const fs = mockFs({ "/ws/notes.md": "[the report](./docs/report.pdf)" });
    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.assets).toBe(1);
    expect(fs.copies).toEqual([{ src: "/ws/docs/report.pdf", dest: "/out/docs/report.pdf" }]);
    expect(fs.writes.get("/out/notes.html")).toContain('href="docs/report.pdf"');
  });

  it("inlines plugin diagrams as their static render", async () => {
    const dispose = staticRenderers.register({
      language: "mermaid",
      renderStatic: async () => '<div class="mermaid-diagram"><svg>diagram</svg></div>',
    });
    try {
      const fs = mockFs({ "/ws/d.md": "```mermaid\ngraph TD; A-->B;\n```" });
      await exportSite({ root: "/ws", outDir: "/out" });
      const page = fs.writes.get("/out/d.html") ?? "";
      expect(page).toContain('<div class="mermaid-diagram"><svg>diagram</svg></div>');
    } finally {
      dispose();
    }
  });

  it("keeps a diagram as its source when the plugin is off", async () => {
    const fs = mockFs({ "/ws/d.md": "```mermaid\ngraph TD; A-->B;\n```" });
    await exportSite({ root: "/ws", outDir: "/out" });
    expect(fs.writes.get("/out/d.html")).toContain("language-mermaid");
  });

  it("exports only the markdown family, skipping notebooks, canvases, and D2", async () => {
    const fs = mockFs({
      "/ws/notes.md": "# Notes",
      "/ws/board.canvas": "{}",
      "/ws/nb.ipynb": "{}",
      "/ws/arch.d2": "a -> b",
    });
    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.pages).toBe(2); // notes.html + generated index
    expect(fs.writes.has("/out/board.html")).toBe(false);
    expect(fs.writes.has("/out/nb.html")).toBe(false);
    expect(fs.writes.has("/out/arch.html")).toBe(false);
  });

  it("renders a Mermaid-source .mmd file as a diagram page", async () => {
    const dispose = staticRenderers.register({
      language: "mermaid",
      renderStatic: async () => '<div class="mermaid-diagram"><svg>diagram</svg></div>',
    });
    try {
      const fs = mockFs({ "/ws/flow.mmd": "flowchart TD\n  A --> B" });
      await exportSite({ root: "/ws", outDir: "/out" });
      const page = fs.writes.get("/out/flow.html") ?? "";
      expect(page).toContain('<div class="mermaid-diagram">');
    } finally {
      dispose();
    }
  });

  it("prefers a root index file over the README for index.html", async () => {
    const fs = mockFs({
      "/ws/index.md": "# The Real Index",
      "/ws/README.md": "# Home",
    });
    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.pages).toBe(2);
    // index.md owns index.html; the README exports as a normal page and no
    // deduped index-1.html appears.
    expect(fs.writes.get("/out/index.html")).toContain("The Real Index");
    expect(fs.writes.get("/out/README.html")).toContain("Home");
    expect([...fs.writes.keys()].some((p) => p.includes("index-1"))).toBe(false);
  });

  it("breaks equal-priority index ties by listing order", async () => {
    // Two root index variants both claim index.html: the first listed wins
    // and the other falls through to the case-insensitive dedupe.
    const fs = mockFs({
      "/ws/index.md": "# First Index",
      "/ws/Index.markdown": "# Second Index",
    });
    await exportSite({ root: "/ws", outDir: "/out" });
    expect(fs.writes.get("/out/index.html")).toContain("First Index");
    expect(fs.writes.get("/out/Index-1.html")).toContain("Second Index");
  });

  it("dedupes output paths that collide case-insensitively", async () => {
    // On Windows/macOS filesystems a.html and A.html are the same file; the
    // exported site must stay portable across them.
    const fs = mockFs({
      "/ws/a.md": "# Lower",
      "/ws/A.markdown": "# Upper",
    });
    await exportSite({ root: "/ws", outDir: "/out" });
    expect(fs.writes.get("/out/a.html")).toContain("Lower");
    expect(fs.writes.get("/out/A-1.html")).toContain("Upper");
  });

  it("gives multi-heading pages an outline and skips it on short pages", async () => {
    const fs = mockFs({
      "/ws/long.md": "# One\n\n## Two\n\n### Three",
      "/ws/short.md": "# Only",
    });
    await exportSite({ root: "/ws", outDir: "/out" });
    const long = fs.writes.get("/out/long.html") ?? "";
    expect(long).toContain('<nav class="glyph-site-outline"');
    expect(long).toContain('href="#two"');
    const short = fs.writes.get("/out/short.html") ?? "";
    expect(short).not.toContain('<nav class="glyph-site-outline"');
  });

  it("applies the github theme by default: header on every page, themed style.css", async () => {
    const fs = mockFs({ "/ws/README.md": "# Home", "/ws/guide/intro.md": "# Intro" });
    await exportSite({ root: "/ws", outDir: "/out" });
    const intro = fs.writes.get("/out/guide/intro.html") ?? "";
    expect(intro).toContain(
      '<header class="glyph-site-header"><a href="../index.html">ws</a></header>',
    );
    const index = fs.writes.get("/out/index.html") ?? "";
    expect(index).toContain('<a href="index.html">ws</a>');
    const css = fs.writes.get("/out/style.css") ?? "";
    expect(css).toContain('content: "On this page"');
    expect(css).toContain(".glyph-site-header {");
  });

  it("restores the minimal look with theme plain", async () => {
    const fs = mockFs({
      "/ws/notes.md": "# N",
      "/ws/.glyph/site.json": JSON.stringify({ theme: "plain" }),
    });
    await exportSite({ root: "/ws", outDir: "/out" });
    expect(fs.writes.get("/out/style.css")).not.toContain('content: "On this page"');
  });

  it("applies a plugin-contributed theme by id", async () => {
    const fs = mockFs({
      "/ws/notes.md": "# N",
      "/ws/.glyph/site.json": JSON.stringify({ theme: "solarized" }),
    });
    await exportSite({
      root: "/ws",
      outDir: "/out",
      themes: [{ id: "solarized", label: "Solarized", css: "body { background: #fdf6e3; }" }],
    });
    expect(fs.writes.get("/out/style.css")).toContain("background: #fdf6e3");
  });

  it("fails loudly on an unknown theme id, listing the available ones", async () => {
    mockFs({
      "/ws/notes.md": "# N",
      "/ws/.glyph/site.json": JSON.stringify({ theme: "neon" }),
    });
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(
      /Unknown site theme "neon"\. Available themes: github, plain/,
    );
  });

  it("emits default site metadata without a config file", async () => {
    const fs = mockFs({ "/ws/README.md": "# Home", "/ws/guide/intro.md": "# Intro" });
    await exportSite({ root: "/ws", outDir: "/out" });
    const intro = fs.writes.get("/out/guide/intro.html") ?? "";
    // Page title comes from the h1; the site title defaults to the folder name.
    expect(intro).toContain("<title>Intro · ws</title>");
    expect(intro).toContain('<meta property="og:site_name" content="ws">');
    expect(intro).toContain('<meta property="og:type" content="article">');
    const index = fs.writes.get("/out/index.html") ?? "";
    expect(index).toContain("<title>ws</title>");
    expect(index).toContain('<meta property="og:type" content="website">');
    // No favicon, no robots.txt, no absolute URLs without configuration.
    expect(intro).not.toContain('rel="icon"');
    expect(intro).not.toContain("og:url");
    expect(fs.writes.has("/out/robots.txt")).toBe(false);
  });

  it("applies .glyph/site.json: titles, favicon, social tags, robots", async () => {
    const fs = mockFs({
      "/ws/README.md": "---\ndescription: The front page\n---\n\n# Home",
      "/ws/.glyph/site.json": JSON.stringify({
        title: "Field Notes",
        description: "A site of notes",
        baseUrl: "https://example.com/notes/",
        favicon: "assets/logo.png",
        robots: "none",
      }),
      "/ws/assets/logo.png": "<binary>",
    });
    await exportSite({ root: "/ws", outDir: "/out" });
    const index = fs.writes.get("/out/index.html") ?? "";
    expect(index).toContain("<title>Field Notes</title>");
    expect(index).toContain('<meta property="og:site_name" content="Field Notes">');
    expect(index).toContain('<meta name="description" content="The front page">');
    expect(index).toContain('<meta property="og:url" content="https://example.com/notes/">');
    expect(index).toContain('<link rel="icon" type="image/png" href="assets/logo.png">');
    expect(fs.copies).toContainEqual({ src: "/ws/assets/logo.png", dest: "/out/assets/logo.png" });
    expect(fs.writes.get("/out/robots.txt")).toBe("User-agent: *\nDisallow: /\n");
  });

  it("copies the social image and emits absolute og:image under the base URL", async () => {
    const fs = mockFs({
      "/ws/notes.md": "# N",
      "/ws/.glyph/site.json": JSON.stringify({
        baseUrl: "https://example.com/",
        socialImage: "assets/card.png",
      }),
      "/ws/assets/card.png": "<binary>",
    });
    await exportSite({ root: "/ws", outDir: "/out" });
    expect(fs.copies).toContainEqual({ src: "/ws/assets/card.png", dest: "/out/assets/card.png" });
    const page = fs.writes.get("/out/notes.html") ?? "";
    expect(page).toContain(
      '<meta property="og:image" content="https://example.com/assets/card.png">',
    );
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("fails loudly on a missing configured social image", async () => {
    mockFs({
      "/ws/notes.md": "# N",
      "/ws/.glyph/site.json": JSON.stringify({
        baseUrl: "https://example.com/",
        socialImage: "gone.png",
      }),
    });
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(
      /socialImage not found in the workspace: gone\.png/,
    );
  });

  it("auto-detects a conventional root favicon", async () => {
    const fs = mockFs({ "/ws/notes.md": "# N", "/ws/favicon.ico": "<binary>" });
    await exportSite({ root: "/ws", outDir: "/out" });
    const page = fs.writes.get("/out/notes.html") ?? "";
    expect(page).toContain('<link rel="icon" type="image/x-icon" href="favicon.ico">');
    expect(fs.copies).toContainEqual({ src: "/ws/favicon.ico", dest: "/out/favicon.ico" });
  });

  it("fails loudly on a malformed config or a missing configured favicon", async () => {
    mockFs({ "/ws/notes.md": "# N", "/ws/.glyph/site.json": "{nope" });
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(/not valid JSON/);

    mockFs({
      "/ws/notes.md": "# N",
      "/ws/.glyph/site.json": JSON.stringify({ favicon: "gone.png" }),
    });
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(
      /favicon not found in the workspace: gone\.png/,
    );
  });

  it("rejects a config favicon that traverses out of the workspace", async () => {
    const fs = mockFs({
      "/ws/notes.md": "# N",
      "/ws/.glyph/site.json": JSON.stringify({ favicon: "../outside/secret.png" }),
      "/outside/secret.png": "<binary>",
    });
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(
      /"favicon" must stay inside the workspace/,
    );
    expect(fs.copies).toEqual([]);
  });

  it("tolerates a missing asset instead of failing the export", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fs = mockFs({ "/ws/notes.md": "![gone](./missing.png) ![ok](./ok.png)" });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, string>;
      if (cmd === "copy_file" && a.src === "/ws/missing.png") {
        return Promise.reject(new Error("os error 2"));
      }
      return base(cmd, args);
    });

    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.assets).toBe(1);
    expect(fs.copies).toEqual([{ src: "/ws/ok.png", dest: "/out/ok.png" }]);
    // The page is written with a reference that leads nowhere, so say which.
    expect(result.failedAssets).toEqual(['"missing.png": os error 2']);
    expect(fs.writes.has("/out/notes.html")).toBe(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("names every asset that failed to copy, and keeps the previous copy of those still in the workspace", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fs = mockFs({
      "/ws/notes.md": "![a](./a.png) ![b](./img/b.png) [c](./c.pdf) ![ok](./ok.png)",
      "/ws/a.png": "<binary>",
      "/ws/img/b.png": "<binary>",
    });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, string>;
      // A rejected command throws its Err string, not an Error.
      if (cmd === "copy_file" && a.src !== "/ws/ok.png") {
        return Promise.reject("Failed to copy file: Access is denied. (os error 5)");
      }
      return base(cmd, args);
    });

    const result = await exportSite({ root: "/ws", outDir: "/out" });

    expect(result.assets).toBe(1);
    expect(result.failedAssets).toEqual([
      '"a.png": Failed to copy file: Access is denied. (os error 5)',
      '"img/b.png": Failed to copy file: Access is denied. (os error 5)',
      '"c.pdf": Failed to copy file: Access is denied. (os error 5)',
    ]);
    // The pages still point at these two, and the copies a previous export
    // left are the files to publish. `c.pdf` is gone from the workspace, so
    // its copy is stale like the page of a deleted note.
    expect(fs.unreplaced[0]).toEqual(["a.png", "img/b.png"]);
    expect(fs.pruned[0]).not.toContain("a.png");
    error.mockRestore();
  });

  it("copies nothing for a link to a folder, and has nothing to report about it", async () => {
    const fs = mockFs({ "/ws/notes.md": "[examples](./examples) ![ok](./ok.png)" });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, string>;
      // What the command answers for a source that is a folder.
      if (cmd === "copy_file" && a.src === "/ws/examples") return Promise.resolve(false);
      return base(cmd, args);
    });

    const result = await exportSite({ root: "/ws", outDir: "/out" });

    expect(result.assets).toBe(1);
    expect(result.failedAssets).toEqual([]);
    expect(fs.pruned[0]).not.toContain("examples");
    expect(fs.unreplaced[0]).toEqual([]);
  });

  it("hands the pruner every file it wrote, and reports what was removed", async () => {
    const fs = mockFs(
      {
        "/ws/README.md": "# Home",
        "/ws/guide/intro.md": "# Intro\n\n![shot](./shot.png)",
        "/ws/.glyph/site.json": JSON.stringify({ robots: "none" }),
        "/ws/guide/shot.png": "<binary>",
      },
      { removed: 2, error: null },
    );

    const result = await exportSite({ root: "/ws", outDir: "/out" });

    expect(result.removed).toBe(2);
    expect(result.pruneError).toBeNull();
    expect(fs.pruned).toHaveLength(1);
    expect([...fs.pruned[0]].sort()).toEqual([
      "guide/intro.html",
      "guide/shot.png",
      "index.html",
      "robots.txt",
      "site.js",
      "style.css",
    ]);
  });

  it("leaves the previous copy of an asset deleted from the workspace to the pruner", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fs = mockFs({ "/ws/notes.md": "![gone](./missing.png)" });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      if (cmd === "copy_file") return Promise.reject(new Error("os error 2"));
      return base(cmd, args);
    });

    await exportSite({ root: "/ws", outDir: "/out" });

    // Claiming it would make the next export believe it owns a file that is
    // not there, and a later real copy of the same name would go unpruned.
    expect(fs.pruned[0]).not.toContain("missing.png");
    // Nor is it held back: a file deleted on purpose must not stay published
    // because a note still names it.
    expect(fs.unreplaced[0]).toEqual([]);
    error.mockRestore();
  });

  it("carries a prune that fell short, with what it did remove", async () => {
    // The command succeeds here: some stale pages went, one is still published.
    const stuck = 'Failed to remove "guide.html": Access is denied. (os error 5)';
    mockFs({ "/ws/README.md": "# A" }, { removed: 2, error: stuck });

    const result = await exportSite({ root: "/ws", outDir: "/out" });

    expect(result).toEqual({
      pages: 1,
      assets: 0,
      removed: 2,
      failedAssets: [],
      pruneError: stuck,
    });
  });

  it("succeeds when the prune fails, and says why it failed", async () => {
    const fs = mockFs({ "/ws/README.md": "# A" });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      // A rejected command throws its Err string, not an Error.
      if (cmd === "prune_export_dir") return Promise.reject("Failed to read the manifest: locked");
      return base(cmd, args);
    });

    // Every page and asset is on disk; only the cleanup failed.
    const result = await exportSite({ root: "/ws", outDir: "/out" });

    expect(result).toEqual({
      pages: 1,
      assets: 0,
      removed: 0,
      failedAssets: [],
      pruneError: "Failed to read the manifest: locked",
    });
    expect(fs.writes.has("/out/index.html")).toBe(true);
  });

  it("does not prune when the export fails part way through", async () => {
    const fs = mockFs({ "/ws/a.md": "# A" });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, string>;
      if (cmd === "write_file" && a.path === "/out/style.css") {
        return Promise.reject(new Error("disk full"));
      }
      return base(cmd, args);
    });

    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(/disk full/);

    // Pruning a half-written site against its own list would delete the pages
    // the previous, complete export left serving.
    expect(fs.pruned).toEqual([]);
  });

  it("rejects when the workspace has no markdown files", async () => {
    mockFs({});
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(/no markdown files/i);
  });

  it("propagates write failures", async () => {
    mockFs({ "/ws/a.md": "# A" });
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, string>;
      if (cmd === "list_markdown_files")
        return Promise.resolve({
          files: ["/ws/a.md"],
          status: { truncated: false, reason: null, limit: null },
        });
      // Only the markdown file exists; the config probe rejects like a real
      // missing file, which the exporter treats as "no config".
      if (cmd === "read_file") {
        return a.path === "/ws/a.md"
          ? Promise.resolve("# A")
          : Promise.reject(new Error("not found"));
      }
      if (cmd === "check_path_exists") return Promise.reject(new Error("not found"));
      return Promise.reject(new Error("disk full"));
    });
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow("disk full");
  });
});
