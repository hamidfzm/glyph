import { type ComponentPropsWithoutRef, isValidElement, type ReactNode } from "react";
import { FencedMountSlot } from "@/components/plugins/FencedMountSlot";
import { useLightbox } from "@/contexts/LightboxContext";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { isFencedRendererMount } from "@/lib/plugins/fencedRenderers";
import { CopyButton } from "./CopyButton";
import { CsvTable } from "./CsvTable";
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
  const lightbox = useLightbox();

  if (isValidElement<CodeProps>(children)) {
    const className = children.props.className ?? "";
    if (/\blanguage-mermaid\b/.test(className)) {
      const code = extractText(children.props.children).trim();
      return <MermaidDiagram code={code} />;
    }
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
      const code = extractText(children.props.children).trim();
      const openLightbox = lightbox?.openSrc;
      let rendered: ReactNode;
      if (isFencedRendererMount(custom.render)) {
        rendered = (
          <FencedMountSlot renderer={custom.render} code={code} openLightbox={openLightbox} />
        );
      } else {
        const Render = custom.render;
        rendered = <Render code={code} openLightbox={openLightbox} />;
      }
      // Print and PDF export find the block by these to re-render it through
      // the plugin's renderStatic.
      return (
        <div data-fenced-language={custom.language} data-fenced-source={code}>
          {rendered}
        </div>
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
