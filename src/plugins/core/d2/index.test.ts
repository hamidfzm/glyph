import { describe, expect, it, vi } from "vitest";
import type { GlyphPluginContext } from "@/lib/plugins/types";
import plugin from "./index";

const renderD2 = vi.hoisted(() => vi.fn(async () => "<svg></svg>"));
vi.mock("./d2Render", () => ({ renderD2 }));

function fakeContext() {
  return {
    registerTranslations: vi.fn(),
    ui: { addStyles: vi.fn() },
    markdown: { registerFencedRenderer: vi.fn() },
    documents: { registerFileType: vi.fn() },
  };
}

describe("D2 core plugin", () => {
  it("registers only through the public plugin API", async () => {
    const ctx = fakeContext();
    await plugin.activate(ctx as unknown as GlyphPluginContext);

    expect(ctx.documents.registerFileType).toHaveBeenCalledWith({
      extensions: ["d2"],
      language: "d2",
    });
    // Vitest does not process CSS, so the stylesheet text itself is checked by the build.
    expect(ctx.ui.addStyles).toHaveBeenCalledWith(expect.any(String));
    expect(
      ctx.registerTranslations.mock.calls.map(([locale, namespace]) => [locale, namespace]),
    ).toEqual([
      ["en", "d2"],
      ["de", "d2"],
      ["es", "d2"],
      ["fa", "d2"],
      ["zh", "d2"],
    ]);
    const [language, , options] = ctx.markdown.registerFencedRenderer.mock.calls[0];
    expect(language).toBe("d2");

    // Print and PDF are on white paper, so the static render is the light theme.
    await options.renderStatic("x -> y");
    expect(renderD2).toHaveBeenCalledWith("x -> y", false);
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
