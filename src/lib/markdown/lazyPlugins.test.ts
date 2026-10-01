import { describe, expect, it, vi } from "vitest";
import type { LazyMarkdownPlugin, MarkdownPlugin } from "@/lib/plugins/types";
import { expectConsole } from "@/test/consoleGuard";
import {
  isLazyMarkdownPlugin,
  loadForDocument,
  type RehypeContribution,
  readyPlugins,
  resolveForDocument,
} from "./lazyPlugins";
import { pendingPluginLoads } from "./pluginLoads";

const plugin = (): MarkdownPlugin => () => () => {};

function lazy(loaded: MarkdownPlugin, word = "math"): LazyMarkdownPlugin {
  return { detect: (markdown) => markdown.includes(word), load: vi.fn(async () => loaded) };
}

describe("isLazyMarkdownPlugin", () => {
  it("tells a lazy entry from a plugin, a tuple, and a preset", () => {
    expect(isLazyMarkdownPlugin(lazy(plugin()))).toBe(true);
    expect(isLazyMarkdownPlugin(plugin())).toBe(false);
    expect(isLazyMarkdownPlugin([plugin(), {}] as MarkdownPlugin)).toBe(false);
    expect(isLazyMarkdownPlugin({ plugins: [plugin()] })).toBe(false);
  });
});

describe("resolveForDocument", () => {
  it("skips a lazy entry the document does not need, and never loads it", async () => {
    const plain = plugin();
    const entry = lazy(plugin());
    expect(await resolveForDocument([plain, entry], "no formulas")).toEqual([plain]);
    expect(entry.load).not.toHaveBeenCalled();
  });

  it("loads a needed entry once and keeps registration order", async () => {
    const first = plugin();
    const loaded = plugin();
    const last = plugin();
    const entry = lazy(loaded);
    const entries = [first, entry, last];
    expect(await resolveForDocument(entries, "some math")).toEqual([first, loaded, last]);
    await resolveForDocument(entries, "more math");
    expect(entry.load).toHaveBeenCalledTimes(1);
  });

  it("keeps a loaded entry for documents that do not need it (a no-op there)", async () => {
    const loaded = plugin();
    const entry = lazy(loaded);
    await resolveForDocument([entry], "math");
    expect(await resolveForDocument([entry], "prose")).toEqual([loaded]);
  });

  it("counts a load in flight for export readiness", async () => {
    let finish: (value: MarkdownPlugin) => void = () => {};
    const entry: LazyMarkdownPlugin = {
      detect: () => true,
      load: vi.fn(() => new Promise<MarkdownPlugin>((resolve) => (finish = resolve))),
    };
    const before = pendingPluginLoads();
    const done = loadForDocument([entry], "x");
    expect(pendingPluginLoads()).toBe(before + 1);
    await vi.waitFor(() => expect(entry.load).toHaveBeenCalled());
    finish(plugin());
    await done;
    expect(pendingPluginLoads()).toBe(before);
  });

  it("logs a failed load once, never retries it, and renders without it", async () => {
    expectConsole(/failed to load/);
    const entry: LazyMarkdownPlugin = {
      detect: () => true,
      load: vi.fn(() => Promise.reject(new Error("chunk"))),
    };
    const plain = plugin();
    expect(await resolveForDocument([plain, entry], "x")).toEqual([plain]);
    await resolveForDocument([plain, entry], "y");
    expect(entry.load).toHaveBeenCalledTimes(1);
  });

  it("treats a detect that throws as not needed", async () => {
    expectConsole(/detect threw/);
    const entry: LazyMarkdownPlugin = {
      detect: () => {
        throw new Error("bug");
      },
      load: vi.fn(async () => plugin()),
    };
    expect(await resolveForDocument([entry], "x")).toEqual([]);
    expect(entry.load).not.toHaveBeenCalled();
  });
});

describe("readyPlugins", () => {
  it("returns the same list until a load lands", async () => {
    const entries: RehypeContribution[] = [plugin(), lazy(plugin())];
    const before = readyPlugins(entries);
    expect(readyPlugins(entries)).toBe(before);
    await loadForDocument(entries, "math");
    expect(readyPlugins(entries)).not.toBe(before);
    expect(readyPlugins(entries)).toHaveLength(2);
  });
});
