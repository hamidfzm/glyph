import { type ComponentPropsWithoutRef, isValidElement, type ReactNode } from "react";
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

export function CodeBlockComponent(props: ComponentPropsWithoutRef<"pre">) {
  const { children, ...rest } = props;

  if (isValidElement<CodeProps>(children)) {
    const className = children.props.className ?? "";
    if (/\blanguage-mermaid\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <MermaidDiagram code={code} />;
    }
  }

  return <pre {...rest}>{children}</pre>;
}
