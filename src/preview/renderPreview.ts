import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import remarkMath from "remark-math";
import { FrontmatterBlock } from "@/components/markdown/FrontmatterBlock";
import { renderPageHtml } from "@/lib/export/site/renderPage";
import { inlineStaticRenders } from "@/lib/export/site/staticInline";
import { parseFrontmatter } from "@/lib/frontmatter";
import type { LazyMarkdownPlugin, MarkdownPlugin } from "@/lib/plugins/types";
import { hasMath } from "@/plugins/core/math/mathPattern";
import { loadRehypeMath } from "@/plugins/core/math/rehypeMath";
import { renderMermaidPreview } from "@/plugins/core/mermaid/mermaidRender";
import { rehypePreviewImages } from "./previewImages";

export interface PreviewOptions {
  dark: boolean;
  /** Where the previewed file's folder is served, for relative images. */
  baseUrl: string;
}

// KaTeX and its stylesheet load only for a file containing math, as in the app.
const math: LazyMarkdownPlugin = {
  detect: hasMath,
  load: async () => {
    await import("katex/dist/katex.min.css");
    return loadRehypeMath();
  },
};

// The site export's React-free pipeline plus the frontmatter table the app
// draws with a component, math, and Mermaid diagrams in the current theme. The
// pane has no plugin host or settings, so it calls the math and Mermaid core
// plugins directly, whatever their toggles in the app.
export async function renderPreview(
  content: string,
  { dark, baseUrl }: PreviewOptions,
): Promise<string> {
  const frontmatter = parseFrontmatter(content);
  const header = frontmatter
    ? renderToStaticMarkup(createElement(FrontmatterBlock, { data: frontmatter }))
    : "";
  const body = await renderPageHtml({
    content,
    // No workspace index in a preview: wikilinks render unresolved.
    resolutions: new Map(),
    extraRemark: [remarkMath],
    extraRehype: [[rehypePreviewImages, baseUrl] as MarkdownPlugin, math],
  });
  const withDiagrams = await inlineStaticRenders(body, (language) =>
    language === "mermaid"
      ? async (code) =>
          `<div class="mermaid-diagram">${await renderMermaidPreview(code, dark)}</div>`
      : undefined,
  );
  return header + withDiagrams;
}
