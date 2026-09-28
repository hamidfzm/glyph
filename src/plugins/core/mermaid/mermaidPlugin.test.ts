import { describe, expect, it, vi } from "vitest";
import type { GlyphPluginContext } from "@/lib/plugins/types";
import plugin from "./mermaidPlugin";

const renderMermaidStatic = vi.hoisted(() => vi.fn(async () => "<svg></svg>"));
vi.mock("./mermaidRender", () => ({ renderMermaidStatic }));

function fakeContext() {
  return {
    registerTranslations: vi.fn(),
    ui: { addStyles: vi.fn() },
    markdown: { registerFencedRenderer: vi.fn() },
    documents: { registerFileType: vi.fn() },
    i18n: { t: vi.fn(), onLanguageChange: vi.fn() },
  };
}

describe("Mermaid core plugin", () => {
  it("registers only through the public plugin API", async () => {
    const ctx = fakeContext();
    await plugin.activate(ctx as unknown as GlyphPluginContext);

    // `.mmd` is shared with MultiMarkdown, so the app sniffs it rather than
    // the plugin claiming the extension.
    expect(ctx.documents.registerFileType).not.toHaveBeenCalled();
    // Vitest does not process CSS, so the stylesheet text itself is checked by the build.
    expect(ctx.ui.addStyles).toHaveBeenCalledWith(expect.any(String));
    expect(
      ctx.registerTranslations.mock.calls.map(([locale, namespace]) => [locale, namespace]),
    ).toEqual([
      ["en", "glyph.core.mermaid"],
      ["de", "glyph.core.mermaid"],
      ["es", "glyph.core.mermaid"],
      ["fa", "glyph.core.mermaid"],
      ["zh", "glyph.core.mermaid"],
    ]);
    const [language, renderer, options] = ctx.markdown.registerFencedRenderer.mock.calls[0];
    expect(language).toBe("mermaid");
    expect(typeof renderer.mount).toBe("function");

    expect(await options.renderStatic("graph TD; A-->B")).toBe(
      '<div class="mermaid-diagram"><svg></svg></div>',
    );
    expect(renderMermaidStatic).toHaveBeenCalledWith("graph TD; A-->B");
  });

  it("ships every string in all five locales", async () => {
    const ctx = fakeContext();
    await plugin.activate(ctx as unknown as GlyphPluginContext);
    const keySets = ctx.registerTranslations.mock.calls.map(([, , resources]) =>
      Object.keys(resources).sort(),
    );
    for (const keys of keySets) expect(keys).toEqual(keySets[0]);
  });
});
