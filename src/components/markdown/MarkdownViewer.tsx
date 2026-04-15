import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CodeBlockComponent } from "./CodeBlockComponent";
import { headingComponents } from "./HeadingComponent";
import { useImageComponent } from "./ImageComponent";
import { LinkComponent } from "./LinkComponent";

interface MarkdownViewerProps {
  content: string;
  filePath?: string;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
}

export function MarkdownViewer({
  content,
  filePath,
  initialScrollTop = 0,
  onScrollChange,
}: MarkdownViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="markdown-body px-8 py-6 pb-[60vh]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath, remarkGemoji]}
          rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }], rehypeKatex]}
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
  );
}
