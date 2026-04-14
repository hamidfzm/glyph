import {
  type ComponentPropsWithoutRef,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { MermaidDiagram } from "./MermaidDiagram";

interface CodeProps {
  className?: string;
  children?: ReactNode;
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<CodeProps>(node) && node.props.children) {
    return extractText(node.props.children);
  }
  return "";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      className={`code-copy-button${copied ? " copied" : ""}`}
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
    >
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 4.5L6 12L2.5 8.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect
            x="5.5"
            y="5.5"
            width="8"
            height="8"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

export function CodeBlockComponent(props: ComponentPropsWithoutRef<"pre">) {
  const { children, ...rest } = props;

  if (isValidElement<CodeProps>(children)) {
    const className = children.props.className ?? "";
    if (/\blanguage-mermaid\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <MermaidDiagram code={code} />;
    }
  }

  const codeText = isValidElement<CodeProps>(children)
    ? extractText(children.props.children).trim()
    : "";

  return (
    <div className="code-block-wrapper">
      {codeText && <CopyButton text={codeText} />}
      <pre {...rest}>{children}</pre>
    </div>
  );
}
