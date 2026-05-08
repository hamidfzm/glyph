import { useCallback, useEffect, useMemo, useRef } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";
import remarkMath from "remark-math";
import { useKatexPlugin } from "../../hooks/useKatexPlugin";
import { useSearch } from "../../hooks/useSearch";
import { remarkWikilink } from "../../lib/wikilink";
import { SearchBar } from "../layout/SearchBar";
import { CodeBlockComponent } from "./CodeBlockComponent";
import { useImageComponent } from "./ImageComponent";
import { LinkComponent, type LinkComponentProps } from "./LinkComponent";
import { markdownSanitizeSchema } from "./sanitizeSchema";
import { TaskListItem } from "./TaskListItem";

interface MarkdownViewerProps {
  content: string;
  filePath?: string;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
  workspaceFiles?: string[];
  onOpenWikilink?: (path: string, heading?: string) => void;
  onTaskToggle?: (line: number) => void;
}

export function MarkdownViewer({
  content,
  filePath,
  initialScrollTop = 0,
  onScrollChange,
  searchOpen,
  onSearchClose,
  workspaceFiles,
  onOpenWikilink,
  onTaskToggle,
}: MarkdownViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const search = useSearch({ containerRef: contentRef });
  const katexPlugin = useKatexPlugin(content);

  // Restore scroll position on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — restore once when tab activates
  useEffect(() => {
    const el = scrollRef.current;
    if (el && initialScrollTop > 0) {
      requestAnimationFrame(() => {
        el.scrollTop = initialScrollTop;
      });
    }
  }, []);

  // Report scroll position changes to parent
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onScrollChange) return;

    const handler = () => {
      onScrollChange(el.scrollTop);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [onScrollChange]);

  const ImageComponent = useImageComponent(filePath);

  const handleSearchClose = () => {
    search.clear();
    onSearchClose();
  };

  const rehypePlugins: NonNullable<Options["rehypePlugins"]> = useMemo(() => {
    const plugins: NonNullable<Options["rehypePlugins"]> = [
      rehypeRaw,
      [rehypeSanitize, markdownSanitizeSchema],
      rehypeSlug,
      [rehypeHighlight, { plainText: ["mermaid"] }],
    ];
    if (katexPlugin) plugins.push(katexPlugin);
    return plugins;
  }, [katexPlugin]);

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
    (props: LinkComponentProps) => <LinkComponent {...props} onOpenWikilink={onOpenWikilink} />,
    [onOpenWikilink],
  );

  const TaskListLi = useCallback(
    (props: React.ComponentProps<typeof TaskListItem>) => (
      <TaskListItem {...props} onTaskToggle={onTaskToggle} />
    ),
    [onTaskToggle],
  );

  return (
    <div className="flex-1 relative">
      {searchOpen && (
        <SearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          matchCount={search.matchCount}
          currentMatch={search.currentMatch}
          onNext={search.nextMatch}
          onPrev={search.prevMatch}
          onClose={handleSearchClose}
        />
      )}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        // Keep anchor targets a few pixels off the top edge when scrolled to
        // via TOC / `#anchor`. Browsers cap scrollIntoView at maxScroll, so
        // end-of-document targets land near the bottom of the viewport —
        // no big empty padding under the content needed for that to work.
        style={{ scrollPaddingTop: "16px" }}
      >
        <div ref={contentRef} className="markdown-body px-8 py-6">
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
        </div>
      </div>
    </div>
  );
}
