import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CodeBlockComponent } from "./CodeBlockComponent";
import { headingComponents } from "./HeadingComponent";
import { useImageComponent } from "./ImageComponent";
import { LinkComponent } from "./LinkComponent";

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
  });

  const ImageComponent = useImageComponent(filePath);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="markdown-body px-8 py-6 pb-[60vh]">
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
