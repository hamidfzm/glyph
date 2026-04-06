import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { headingComponents } from "./HeadingComponent";
import { LinkComponent } from "./LinkComponent";
import { useImageComponent } from "./ImageComponent";
import { CodeBlockComponent } from "./CodeBlockComponent";

interface MarkdownViewerProps {
  content: string;
  filePath?: string;
}

export function MarkdownViewer({ content, filePath }: MarkdownViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handler = () => {
      scrollPosRef.current = el.scrollTop;
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && scrollPosRef.current > 0) {
      requestAnimationFrame(() => {
        el.scrollTop = scrollPosRef.current;
      });
    }
  }, [content]);

  const ImageComponent = useImageComponent(filePath);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto"
    >
      <div className="markdown-body px-8 py-6 pb-24">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }]]}
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
