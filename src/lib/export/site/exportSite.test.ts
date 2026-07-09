import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreMermaidTheme } from "@/lib/export/rasterize";
import { exportSite } from "./exportSite";

vi.mock("@/lib/export/rasterize", () => ({
  renderMermaidLightSvg: vi.fn(() => Promise.resolve("<svg>diagram</svg>")),
  restoreMermaidTheme: vi.fn(() => Promise.resolve()),
}));

interface FakeFs {
  writes: Map<string, string>;
  dirs: string[];
  copies: Array<{ src: string; dest: string }>;
}

function mockFs(files: Record<string, string>): FakeFs {
  const fs: FakeFs = { writes: new Map(), dirs: [], copies: [] };
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, string>;
    switch (cmd) {
      case "list_markdown_files":
        return Promise.resolve(Object.keys(files));
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
        return Promise.resolve(undefined);
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
  return fs;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(restoreMermaidTheme).mockClear();
});

describe("exportSite", () => {
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

    expect(result).toEqual({ pages: 2, assets: 0 });
    expect([...fs.writes.keys()].sort()).toEqual([
      "/out/guide/intro.html",
      "/out/index.html",
      "/out/style.css",
    ]);
    expect(progress[0]).toEqual([0, 2]);
    expect(progress.at(-1)).toEqual([2, 2]);

    const intro = fs.writes.get("/out/guide/intro.html") ?? "";
    expect(intro).toContain('<link rel="stylesheet" href="../style.css">');
    expect(intro).toContain('class="glyph-site-nav"');
    expect(intro).toContain('href="../index.html"');
    expect(fs.dirs).toContain("/out/guide");
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

  it("inlines mermaid diagrams and restores the app theme afterwards", async () => {
    const fs = mockFs({ "/ws/d.md": "```mermaid\ngraph TD; A-->B;\n```" });
    await exportSite({ root: "/ws", outDir: "/out" });
    const page = fs.writes.get("/out/d.html") ?? "";
    expect(page).toContain('<div class="mermaid-diagram"><svg>diagram</svg></div>');
    expect(restoreMermaidTheme).toHaveBeenCalledTimes(1);
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
    const fs = mockFs({ "/ws/flow.mmd": "flowchart TD\n  A --> B" });
    await exportSite({ root: "/ws", outDir: "/out" });
    const page = fs.writes.get("/out/flow.html") ?? "";
    expect(page).toContain('<div class="mermaid-diagram">');
  });

  it("keeps README as index.html when another page collides case-insensitively", async () => {
    // On Windows/macOS filesystems Index.html and index.html are the same
    // file; the exported site must stay portable across them.
    const fs = mockFs({
      "/ws/Index.md": "# The Index Note",
      "/ws/README.md": "# Home",
    });
    const result = await exportSite({ root: "/ws", outDir: "/out" });
    expect(result.pages).toBe(2);
    expect(fs.writes.get("/out/index.html")).toContain("Home");
    expect(fs.writes.get("/out/Index-1.html")).toContain("The Index Note");
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
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("rejects when the workspace has no markdown files", async () => {
    mockFs({});
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow(/no markdown files/i);
  });

  it("propagates write failures", async () => {
    mockFs({ "/ws/a.md": "# A" });
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "list_markdown_files"
        ? Promise.resolve(["/ws/a.md"])
        : cmd === "read_file"
          ? Promise.resolve("# A")
          : Promise.reject(new Error("disk full")),
    );
    await expect(exportSite({ root: "/ws", outDir: "/out" })).rejects.toThrow("disk full");
  });
});
