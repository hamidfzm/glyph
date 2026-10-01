import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type PluggableList, unified } from "unified";
import { describe, expect, it, vi } from "vitest";
import type { GlyphPluginContext, LazyMarkdownPlugin, MarkdownPlugin } from "@/lib/plugins/types";
import plugin from "./mathPlugin";

function activate() {
  const remark: MarkdownPlugin[] = [];
  const rehype: unknown[] = [];
  const addStyles = vi.fn(() => () => {});
  const ctx = {
    ui: { addStyles },
    markdown: {
      registerRemarkPlugin: (p: MarkdownPlugin) => {
        remark.push(p);
        return () => {};
      },
      registerRehypePlugin: (p: unknown) => {
        rehype.push(p);
        return () => {};
      },
    },
  } as unknown as GlyphPluginContext;
  plugin.activate(ctx);
  return { remark, lazy: rehype[0] as LazyMarkdownPlugin, addStyles };
}

describe("math core plugin", () => {
  it("registers remark-math, its styles, and KaTeX as a lazy rehype plugin", () => {
    const { remark, lazy, addStyles } = activate();
    expect(remark).toHaveLength(1);
    expect(addStyles).toHaveBeenCalledTimes(1);
    expect(lazy.detect("$x$")).toBe(true);
    expect(lazy.detect("prose")).toBe(false);
  });

  it("loads KaTeX with its stylesheet and renders math inside the marker", async () => {
    const { remark, lazy, addStyles } = activate();
    const rehypeMath = await lazy.load();
    expect(addStyles).toHaveBeenCalledTimes(2);

    const file = await unified()
      .use(remarkParse)
      .use(remark as PluggableList)
      .use(remarkRehype)
      .use([rehypeMath] as PluggableList)
      .use(rehypeStringify)
      .process("inline $x^2$ and\n\n$$\ny\n$$");
    const html = String(file);
    expect(html).toMatch(/<span data-math-source="x\^2"><span class="katex">/);
    expect(html).toMatch(
      /<div data-math-source="y" data-math-display=""><span class="katex-display">/,
    );
  });
});
