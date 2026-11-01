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
import { type ImageSource, rehypePreviewImages } from "./previewImages";

export interface PreviewOptions {
  dark: boolean;
  /** Where relative images in the previewed file's folder load from. */
  images: ImageSource;
}

export interface RenderedPreview {
  html: string;
  /** How many relative images became their alt text, for want of a folder holding them. */
  droppedImages: number;
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
  { dark, images }: PreviewOptions,
): Promise<RenderedPreview> {
  const frontmatter = parseFrontmatter(content);
  const header = frontmatter
    ? renderToStaticMarkup(createElement(FrontmatterBlock, { data: frontmatter }))
    : "";
  let droppedImages = 0;
  const countDrop = () => {
    droppedImages += 1;
  };
  const body = await renderPageHtml({
    content,
    // No workspace index in a preview: wikilinks render unresolved.
    resolutions: new Map(),
    extraRemark: [remarkMath],
    extraRehype: [[rehypePreviewImages, images, countDrop] as MarkdownPlugin, math],
  });
  const withDiagrams = await inlineStaticRenders(body, (language) =>
    language === "mermaid"
      ? async (code) =>
          `<div class="mermaid-diagram">${await renderMermaidPreview(code, dark)}</div>`
      : undefined,
  );
  return { html: header + withDiagrams, droppedImages };
}
