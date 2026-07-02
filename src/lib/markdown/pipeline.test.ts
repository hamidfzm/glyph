import { describe, expect, it, vi } from "vitest";
import type { MarkdownPlugin } from "@/lib/plugins/types";
import { buildRehypePlugins, buildRemarkPlugins } from "./pipeline";

// Plugin entries are functions or [plugin, options] tuples; compare by reference.
const ref = (p: MarkdownPlugin) => (Array.isArray(p) ? p[0] : p);

describe("buildRemarkPlugins", () => {
  it("includes the built-in remark plugins and appends extras in order", () => {
    const extraA = vi.fn();
    const extraB = vi.fn();
    const plugins = buildRemarkPlugins({ extra: [extraA, extraB] });

    // The built-ins come first; the two extras come last, in the given order.
    expect(plugins.slice(-2).map(ref)).toEqual([extraA, extraB]);
    expect(plugins.length).toBeGreaterThanOrEqual(7);
  });

  it("threads workspace context into the wikilink plugin", () => {
    const plugins = buildRemarkPlugins({ workspaceFiles: ["a.md"], filePath: "/w/b.md" });
    const wikilink = plugins.find((p) => Array.isArray(p)) as [unknown, Record<string, unknown>];
    expect(wikilink[1]).toEqual({ workspaceFiles: ["a.md"], currentFilePath: "/w/b.md" });
  });

  it("works with no extras", () => {
    expect(buildRemarkPlugins({}).length).toBeGreaterThanOrEqual(6);
  });
});

describe("buildRehypePlugins", () => {
  it("omits highlight/katex when not provided", () => {
    const plugins = buildRehypePlugins({});
    expect(plugins.length).toBe(3); // raw, sanitize, slug
  });

  it("appends highlight, katex, then plugin extras in order", () => {
    const highlight = vi.fn();
    const katex = vi.fn();
    const extra = vi.fn();
    const plugins = buildRehypePlugins({
      highlightPlugin: highlight,
      katexPlugin: katex,
      extra: [extra],
    });
    expect(plugins.slice(-3).map(ref)).toEqual([highlight, katex, extra]);
  });

  it("keeps sanitize ahead of plugin extras", () => {
    const extra = vi.fn();
    const plugins = buildRehypePlugins({ extra: [extra] });
    // sanitize is a [plugin, schema] tuple in the first three; extra is last.
    expect(ref(plugins[plugins.length - 1])).toBe(extra);
    expect(plugins.some((p) => Array.isArray(p))).toBe(true);
  });
});
