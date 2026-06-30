import { type ComponentPropsWithoutRef, isValidElement, type ReactNode } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { CopyButton } from "./CopyButton";
import { CsvTable } from "./CsvTable";
import { D2Diagram } from "./D2Diagram";
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
  const plugins = usePluginsOptional();
  const fencedRenderers = useRegistryEntries(plugins?.fencedRenderers ?? null);

  if (isValidElement<CodeProps>(children)) {
    const className = children.props.className ?? "";
    if (/\blanguage-mermaid\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <MermaidDiagram code={code} />;
    }
    if (/\blanguage-d2\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <D2Diagram code={code} />;
    }
    if (/\blanguage-csv\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <CsvTable code={code} delimiter="," />;
    }
    if (/\blanguage-tsv\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <CsvTable code={code} delimiter={"\t"} />;
    }
    // Plugin-contributed fenced renderers handle any other language (e.g. d2).
    const lang = /\blanguage-([\w-]+)\b/.exec(className)?.[1];
    const custom = lang && fencedRenderers.find((r) => r.language === lang);
    if (custom) {
      const Render = custom.render;
      return <Render code={extractText(children.props.children).trim()} />;
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
