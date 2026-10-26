import { type ComponentPropsWithoutRef, isValidElement, type ReactNode } from "react";
import type { ExtraProps } from "react-markdown";
import { useLightbox } from "@/contexts/LightboxContext";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import type { FencedBlock } from "@/lib/fencedBlockEdit";
import { CopyButton } from "./CopyButton";
import { CsvTable } from "./CsvTable";
import { PluginFencedBlock } from "./PluginFencedBlock";

interface CodeBlockProps extends ComponentPropsWithoutRef<"pre">, ExtraProps {
  /** Save a plugin-rendered block; only the document's own viewer passes it. */
  onFencedBlockEdit?: (block: FencedBlock, code: string) => Promise<boolean>;
}

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

export function CodeBlockComponent(props: CodeBlockProps) {
  const { children, node, onFencedBlockEdit, ...rest } = props;
  const plugins = usePluginsOptional();
  const fencedRenderers = useRegistryEntries(plugins?.fencedRenderers ?? null);
  const lightbox = useLightbox();

  if (isValidElement<CodeProps>(children)) {
    const className = children.props.className ?? "";
    if (/\blanguage-csv\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <CsvTable code={code} delimiter="," />;
    }
    if (/\blanguage-tsv\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <CsvTable code={code} delimiter={"\t"} />;
    }
    // Plugin-contributed fenced renderers handle any language without a
    // built-in handler above (e.g. a PlantUML plugin registering "plantuml").
    const lang = /\blanguage-([\w-]+)\b/.exec(className)?.[1];
    const custom = lang && fencedRenderers.find((r) => r.language === lang);
    if (custom) {
      // Keyed by language: react-markdown keys blocks by position, and a block
      // of another language taking this place is another block.
      return (
        <PluginFencedBlock
          key={custom.language}
          renderer={custom}
          code={extractText(children.props.children).trim()}
          startLine={node?.position?.start.line}
          endLine={node?.position?.end.line}
          openLightbox={lightbox?.openSrc}
          onFencedBlockEdit={onFencedBlockEdit}
        />
      );
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
