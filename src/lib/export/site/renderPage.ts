import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type PluggableList, unified } from "unified";
import {
  HIGHLIGHT_OPTIONS,
  hasCodeBlock,
  loadHighlight,
} from "@/components/markdown/lazyHighlight";
import { hasMath, loadKatex } from "@/components/markdown/lazyKatex";
import { buildRehypePlugins, buildRemarkPlugins } from "@/lib/markdown/pipeline";
import type { MarkdownPlugin } from "@/lib/plugins/types";

export interface RenderPageOptions {
  content: string;
  /** Absolute path of the markdown file, for wikilink resolution. */
  filePath: string;
  workspaceFiles: string[];
  /** Extra remark plugins appended after the built-ins (plugin-contributed syntax). */
  extraRemark?: readonly MarkdownPlugin[];
  /** Extra rehype plugins appended after the built-ins (plugin-contributed, then site URL rewriting). */
  extraRehype?: readonly MarkdownPlugin[];
}

/**
 * Render one markdown document to sanitized body HTML without mounting React.
 * Reuses the exact remark/rehype chains the live viewer builds (GFM, math,
 * alerts, wikilinks, raw HTML + sanitize, slug ids, highlight, KaTeX) so the
 * generated site matches the in-app rendering. Highlight and KaTeX load
 * lazily, mirroring the viewer's content-sniffing hooks.
 */
export async function renderPageHtml({
  content,
  filePath,
  workspaceFiles,
  extraRemark = [],
  extraRehype = [],
}: RenderPageOptions): Promise<string> {
  const highlightPlugin = hasCodeBlock(content)
    ? ([await loadHighlight(), HIGHLIGHT_OPTIONS] as MarkdownPlugin)
    : null;
  const katexPlugin = hasMath(content) ? await loadKatex() : null;

  const file = await unified()
    .use(remarkParse)
    .use(buildRemarkPlugins({ workspaceFiles, filePath, extra: extraRemark }) as PluggableList)
    // Raw HTML must survive into the hast tree so rehype-raw can parse it and
    // rehype-sanitize can clean it, exactly as react-markdown does internally.
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(buildRehypePlugins({ highlightPlugin, katexPlugin, extra: extraRehype }) as PluggableList)
    .use(rehypeStringify)
    .process(content);
  return String(file);
}
