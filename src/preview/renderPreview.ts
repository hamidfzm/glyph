import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FrontmatterBlock } from "@/components/markdown/FrontmatterBlock";
import { inlineMermaidSvgs } from "@/lib/export/site/mermaidInline";
import { renderPageHtml } from "@/lib/export/site/renderPage";
import { parseFrontmatter } from "@/lib/frontmatter";
import { renderMermaid } from "@/lib/mermaidRender";
import type { MarkdownPlugin } from "@/lib/plugins/types";
import { rehypePreviewImages } from "./previewImages";

export interface PreviewOptions {
  dark: boolean;
  /** Where the previewed file's folder is served, for relative images. */
  baseUrl: string;
}

// The site export's React-free pipeline plus the pieces the app draws with
// components: the frontmatter table and Mermaid diagrams (in the current theme).
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
  const withDiagrams = await inlineMermaidSvgs(body, (source) => renderMermaid(source, dark));
  return header + withDiagrams;
}
