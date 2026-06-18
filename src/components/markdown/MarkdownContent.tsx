import { useCallback, useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";
import remarkMath from "remark-math";
import { LightboxProvider } from "@/contexts/LightboxContext";
import { useHighlightPlugin } from "@/hooks/useHighlightPlugin";
import { useKatexPlugin } from "@/hooks/useKatexPlugin";
import { parseFrontmatter } from "@/lib/frontmatter";
import { isPathInside } from "@/lib/paths";
import { normalizeRelativePath } from "@/lib/relativePath";
import { remarkWikilink } from "@/lib/wikilink";
import { CodeBlockComponent } from "./CodeBlockComponent";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { useImageComponent } from "./ImageComponent";
import { LinkComponent, type LinkComponentProps } from "./LinkComponent";
import { markdownSanitizeSchema } from "./sanitizeSchema";
import { TaskListItem } from "./TaskListItem";

interface MarkdownContentProps {
  content: string;
  filePath?: string;
  workspaceFiles?: string[];
  /** Opened workspace root; enables and constrains relative link/image resolution. */
  workspaceRoot?: string;
  onOpenWikilink?: (path: string, heading?: string) => void;
  /** Open a workspace document by absolute path (used for resolved relative links). */
  onOpenRelativeFile?: (path: string) => void;
  onTaskToggle?: (line: number) => void;
  /** Render a YAML frontmatter block when present. Defaults to true. */
  showFrontmatter?: boolean;
}

// The markdown rendering core: frontmatter block + ReactMarkdown wired up with
// the full plugin/component set (GFM, math, alerts, wikilinks, syntax
// highlighting, sanitized raw HTML). Extracted from MarkdownViewer so both the
// document viewer and notebook markdown/HTML cells render identically. Owns no
// scroll container or search — callers provide those.
export function MarkdownContent({
  content,
  filePath,
  workspaceFiles,
  workspaceRoot,
  onOpenWikilink,
  onOpenRelativeFile,
  onTaskToggle,
  showFrontmatter = true,
}: MarkdownContentProps) {
  const katexPlugin = useKatexPlugin(content);
  const highlightPlugin = useHighlightPlugin(content);
  const frontmatter = useMemo(
    () => (showFrontmatter ? parseFrontmatter(content) : null),
    [content, showFrontmatter],
  );

  const ImageComponent = useImageComponent(filePath, workspaceRoot);

  // Resolve a relative link against this document's directory and open it only
  // when it stays inside the opened workspace. Gating on workspaceRoot keeps
  // single-file mode a no-op (the callback is never wired up there). A trailing
  // `#heading` is dropped during resolution: cross-file heading scroll isn't
  // wired up yet, matching wikilink behavior (see TabContent's open handler).
  const handleOpenRelativeFile = useCallback(
    (href: string) => {
      if (!filePath || !workspaceRoot || !onOpenRelativeFile) return;
      const resolved = normalizeRelativePath(filePath, href);
      if (isPathInside(resolved, workspaceRoot)) onOpenRelativeFile(resolved);
    },
    [filePath, workspaceRoot, onOpenRelativeFile],
  );

  const rehypePlugins: NonNullable<Options["rehypePlugins"]> = useMemo(() => {
    const plugins: NonNullable<Options["rehypePlugins"]> = [
      rehypeRaw,
      [rehypeSanitize, markdownSanitizeSchema],
      rehypeSlug,
    ];
    if (highlightPlugin) plugins.push(highlightPlugin);
    if (katexPlugin) plugins.push(katexPlugin);
    return plugins;
  }, [katexPlugin, highlightPlugin]);

  const remarkPlugins: NonNullable<Options["remarkPlugins"]> = useMemo(
    () => [
      remarkFrontmatter,
      remarkGfm,
      remarkMath,
      remarkGemoji,
      remarkAlert,
      [remarkWikilink, { workspaceFiles, currentFilePath: filePath }],
    ],
    [workspaceFiles, filePath],
  );

  const LinkWithWikilink = useCallback(
    (props: LinkComponentProps) => (
      <LinkComponent
        {...props}
        onOpenWikilink={onOpenWikilink}
        onOpenRelativeFile={workspaceRoot ? handleOpenRelativeFile : undefined}
      />
    ),
    [onOpenWikilink, handleOpenRelativeFile, workspaceRoot],
  );

  const TaskListLi = useCallback(
    (props: React.ComponentProps<typeof TaskListItem>) => (
      <TaskListItem {...props} onTaskToggle={onTaskToggle} />
    ),
    [onTaskToggle],
  );

  return (
    <LightboxProvider>
      {frontmatter && <FrontmatterBlock data={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          a: LinkWithWikilink,
          img: ImageComponent,
          pre: CodeBlockComponent,
          li: TaskListLi,
        }}
      >
        {content}
      </ReactMarkdown>
    </LightboxProvider>
  );
}
