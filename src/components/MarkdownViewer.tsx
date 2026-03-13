import { useRef, useEffect, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownViewerProps {
  content: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

function createHeadingComponent(Tag: HeadingTag) {
  return function HeadingComponent(props: ComponentPropsWithoutRef<HeadingTag>) {
    const { children, ...rest } = props;
    const text = typeof children === "string" ? children : String(children);
    const id = slugify(text);
    return (
      <Tag id={id} {...rest}>
        {children}
      </Tag>
    );
  };
}

const headingComponents = {
  h1: createHeadingComponent("h1"),
  h2: createHeadingComponent("h2"),
  h3: createHeadingComponent("h3"),
  h4: createHeadingComponent("h4"),
  h5: createHeadingComponent("h5"),
  h6: createHeadingComponent("h6"),
};

function LinkComponent(props: ComponentPropsWithoutRef<"a">) {
  const { href, children, ...rest } = props;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (href && !href.startsWith("#")) {
        e.preventDefault();
        window.open(href, "_blank");
      }
    },
    [href],
  );

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef(0);

  // Save scroll position before content update
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handler = () => {
      scrollPosRef.current = el.scrollTop;
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  // Restore scroll position after content change
  useEffect(() => {
    const el = scrollRef.current;
    if (el && scrollPosRef.current > 0) {
      requestAnimationFrame(() => {
        el.scrollTop = scrollPosRef.current;
      });
    }
  }, [content]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto"
    >
      <div className="markdown-body px-8 py-6 pb-24">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            ...headingComponents,
            a: LinkComponent,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
