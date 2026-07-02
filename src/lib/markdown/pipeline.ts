import type { Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";
import remarkMath from "remark-math";
import { markdownSanitizeSchema } from "@/components/markdown/sanitizeSchema";
import type { MarkdownPlugin } from "@/lib/plugins/types";
import { remarkWikilink } from "@/lib/wikilink";

// The markdown remark/rehype pipeline, built outside the render tree so the
// plugin order lives in one documented place and the renderer component shrinks
// to "feed me a processor, give me output" (#225). Pure and React-independent:
// the lazily-loaded highlight/katex plugins and plugin-contributed extras are
// passed in already resolved, not fetched here.

type RemarkPlugins = NonNullable<Options["remarkPlugins"]>;
type RehypePlugins = NonNullable<Options["rehypePlugins"]>;

export interface RemarkPipelineOptions {
  workspaceFiles?: string[];
  filePath?: string;
  /** Plugin-contributed remark plugins, appended after the built-ins. */
  extra?: readonly MarkdownPlugin[];
}

export function buildRemarkPlugins({
  workspaceFiles,
  filePath,
  extra = [],
}: RemarkPipelineOptions): RemarkPlugins {
  return [
    remarkFrontmatter,
    remarkGfm,
    remarkMath,
    remarkGemoji,
    remarkAlert,
    [remarkWikilink, { workspaceFiles, currentFilePath: filePath }],
    ...extra,
  ];
}

export interface RehypePipelineOptions {
  /** Syntax-highlight plugin, lazily loaded only when the document has code. */
  highlightPlugin?: MarkdownPlugin | null;
  /** KaTeX plugin, lazily loaded only when the document has math. */
  katexPlugin?: MarkdownPlugin | null;
  /** Plugin-contributed rehype plugins, appended after the built-ins. */
  extra?: readonly MarkdownPlugin[];
}

export function buildRehypePlugins({
  highlightPlugin,
  katexPlugin,
  extra = [],
}: RehypePipelineOptions): RehypePlugins {
  // Sanitize runs early so raw HTML in the *document* is cleaned. Plugin rehype
  // plugins are appended after it: plugin code is trusted (the user installed
  // it), so its output is intentionally not re-sanitized.
  const plugins: RehypePlugins = [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeSlug];
  if (highlightPlugin) plugins.push(highlightPlugin);
  if (katexPlugin) plugins.push(katexPlugin);
  plugins.push(...extra);
  return plugins;
}
