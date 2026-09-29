import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FrontmatterBlock } from "@/components/markdown/FrontmatterBlock";
import { renderPageHtml } from "@/lib/export/site/renderPage";
import { inlineStaticRenders } from "@/lib/export/site/staticInline";
import { parseFrontmatter } from "@/lib/frontmatter";
import type { MarkdownPlugin } from "@/lib/plugins/types";
import { renderMermaidPreview } from "@/plugins/core/mermaid/mermaidRender";
import { rehypePreviewImages } from "./previewImages";

export interface PreviewOptions {
  dark: boolean;
  /** Where the previewed file's folder is served, for relative images. */
  baseUrl: string;
}

// The site export's React-free pipeline plus the frontmatter table the app
// draws with a component, and Mermaid diagrams in the current theme. The pane
// has no plugin host or settings, so it calls the Mermaid core plugin's
// renderer directly, whatever the plugin's toggle in the app.
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
    extraRehype: [[rehypePreviewImages, baseUrl] as MarkdownPlugin],
  });
  const withDiagrams = await inlineStaticRenders(body, (language) =>
    language === "mermaid"
      ? async (code) =>
          `<div class="mermaid-diagram">${await renderMermaidPreview(code, dark)}</div>`
      : undefined,
  );
  return header + withDiagrams;
}
