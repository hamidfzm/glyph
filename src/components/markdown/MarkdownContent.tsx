import { type ComponentPropsWithoutRef, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { EmbedContext, type EmbedContextValue, useEmbedContext } from "@/contexts/EmbedContext";
import { LightboxProvider } from "@/contexts/LightboxProvider";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { useHighlightPlugin } from "@/hooks/useHighlightPlugin";
import { useKatexPlugin } from "@/hooks/useKatexPlugin";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { useSettings } from "@/hooks/useSettings";
import { parseFrontmatter } from "@/lib/frontmatter";
import { buildRehypePlugins, buildRemarkPlugins } from "@/lib/markdown/pipeline";
import { resolveWorkspacePath } from "@/lib/relativePath";
import { CodeBlockComponent } from "./CodeBlockComponent";
import { EmbedComponent } from "./EmbedComponent";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { useImageComponent, useSvgImageComponent } from "./ImageComponent";
import { LinkComponent, type LinkComponentProps } from "./LinkComponent";
import { MarkdownHeading } from "./MarkdownHeading";
import { TaskListItem } from "./TaskListItem";

// react-markdown maps by tag name, so every `<div>` routes through here: a
// note-embed placeholder emitted by remarkWikilink becomes EmbedComponent,
// everything else (alerts, raw HTML, a user's own `class="markdown-embed"`
// div) renders as a plain div. The `data-embed-target` marker is only ever set
// by the plugin, so it distinguishes a real placeholder from arbitrary markup.
function DivComponent(props: ComponentPropsWithoutRef<"div"> & { node?: unknown }) {
  const { node: _node, ...rest } = props;
  if ("data-embed-target" in rest) {
    return <EmbedComponent {...rest} />;
  }
  return <div {...rest} />;
}

interface MarkdownContentProps {
  content: string;
  filePath?: string;
  workspaceFiles?: string[];
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
  onOpenWikilink,
  onOpenRelativeFile,
  onTaskToggle,
  showFrontmatter = true,
}: MarkdownContentProps) {
  const workspaceRoot = useWorkspaceRoot();
  // Extend the ancestor embed chain with this document's file so a nested
  // embed that points back at an already-rendering file is caught as a cycle.
  const parentEmbed = useEmbedContext();
  const embedValue = useMemo<EmbedContextValue>(() => {
    const base = parentEmbed.chain;
    const chain = filePath && !base.includes(filePath) ? [...base, filePath] : base;
    return { workspaceFiles, onOpenWikilink, chain };
  }, [parentEmbed.chain, filePath, workspaceFiles, onOpenWikilink]);
  const { settings } = useSettings();
  const features = settings.markdown;
  // With math off, skip the KaTeX lazy-load entirely (remark-math is also
  // dropped from the pipeline, so $…$ stays literal text).
  const katexPlugin = useKatexPlugin(features.math ? content : "");
  const highlightPlugin = useHighlightPlugin(content);
  // Plugin-contributed remark/rehype plugins, appended to the built-in pipeline.
  const plugins = usePluginsOptional();
  const pluginRemark = useRegistryEntries(plugins?.remarkPlugins ?? null);
  const pluginRehype = useRegistryEntries(plugins?.rehypePlugins ?? null);
  const frontmatter = useMemo(
    () => (showFrontmatter ? parseFrontmatter(content) : null),
    [content, showFrontmatter],
  );

  const ImageComponent = useImageComponent(filePath);
  const SvgImageComponent = useSvgImageComponent(filePath);

  // Resolve a relative link against this document's directory and open it only
  // when it stays inside the opened workspace. Gating on workspaceRoot keeps
  // single-file mode a no-op (the callback is never wired up there). A trailing
  // `#heading` is dropped during resolution: cross-file heading scroll isn't
  // wired up yet, matching wikilink behavior (see TabContent's open handler).
  const handleOpenRelativeFile = useCallback(
    (href: string) => {
      if (!filePath || !workspaceRoot || !onOpenRelativeFile) return;
      const resolved = resolveWorkspacePath(filePath, href, workspaceRoot);
      if (resolved) onOpenRelativeFile(resolved);
    },
    [filePath, workspaceRoot, onOpenRelativeFile],
  );

  const rehypePlugins = useMemo(
    () => buildRehypePlugins({ highlightPlugin, katexPlugin, extra: pluginRehype }),
    [highlightPlugin, katexPlugin, pluginRehype],
  );

  const remarkPlugins = useMemo(
    () => buildRemarkPlugins({ workspaceFiles, filePath, features, extra: pluginRemark }),
    [workspaceFiles, filePath, features, pluginRemark],
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
    <EmbedContext.Provider value={embedValue}>
      <LightboxProvider>
        {frontmatter && <FrontmatterBlock data={frontmatter} />}
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={{
            a: LinkWithWikilink,
            img: ImageComponent,
            image: SvgImageComponent,
            pre: CodeBlockComponent,
            li: TaskListLi,
            div: DivComponent,
            h1: MarkdownHeading,
            h2: MarkdownHeading,
            h3: MarkdownHeading,
            h4: MarkdownHeading,
            h5: MarkdownHeading,
            h6: MarkdownHeading,
          }}
        >
          {content}
        </ReactMarkdown>
      </LightboxProvider>
    </EmbedContext.Provider>
  );
}
