import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";
import remarkMath from "remark-math";
import { useKatexPlugin } from "../../hooks/useKatexPlugin";
import { useSearch } from "../../hooks/useSearch";
import { SearchBar } from "../layout/SearchBar";
import { CodeBlockComponent } from "./CodeBlockComponent";
import { headingComponents } from "./HeadingComponent";
import { useImageComponent } from "./ImageComponent";
import { LinkComponent } from "./LinkComponent";
import { markdownSanitizeSchema } from "./sanitizeSchema";

interface MarkdownViewerProps {
  content: string;
  filePath?: string;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
}

export function MarkdownViewer({
  content,
  filePath,
  initialScrollTop = 0,
  onScrollChange,
  searchOpen,
  onSearchClose,
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
      [rehypeHighlight, { plainText: ["mermaid"] }],
    ];
    if (katexPlugin) plugins.push(katexPlugin);
    return plugins;
  }, [katexPlugin]);

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
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div ref={contentRef} className="markdown-body px-8 py-6 pb-[60vh]">
          <ReactMarkdown
            remarkPlugins={[remarkFrontmatter, remarkGfm, remarkMath, remarkGemoji, remarkAlert]}
            rehypePlugins={rehypePlugins}
            components={{
              ...headingComponents,
              a: LinkComponent,
              img: ImageComponent,
              pre: CodeBlockComponent,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
