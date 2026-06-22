import { useTranslation } from "react-i18next";
import type { DataOutput } from "@/lib/notebook/types";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { AnsiText } from "./AnsiText";

// MIME types we render, in order of preference. The richest representation an
// output carries wins; anything past `text/plain` we don't yet handle (Plotly,
// Vega, Jupyter widgets) falls through to a placeholder.
const IMAGE_MIMES = ["image/png", "image/jpeg"] as const;

function pickRichest(data: Record<string, string>): string | null {
  for (const mime of IMAGE_MIMES) if (mime in data) return mime;
  if ("image/svg+xml" in data) return "image/svg+xml";
  if ("text/html" in data) return "text/html";
  if ("text/markdown" in data) return "text/markdown";
  if ("text/plain" in data) return "text/plain";
  return null;
}

// Renders a notebook "execute_result" / "display_data" output, choosing the
// richest available MIME representation.
export function DataOutputView({ output, filePath }: { output: DataOutput; filePath?: string }) {
  const { t } = useTranslation("common");
  const mime = pickRichest(output.data);
  if (!mime) {
    const interactive = Object.keys(output.data).find(
      (m) => m.startsWith("application/") && m !== "application/json",
    );
    return (
      <div className="nb-output-unsupported">
        {interactive
          ? t("notebook.unsupportedInteractive", { type: interactive })
          : t("notebook.unsupported")}
      </div>
    );
  }

  const payload = output.data[mime];

  if (mime === "image/png" || mime === "image/jpeg") {
    return <img className="nb-output-image" src={`data:${mime};base64,${payload}`} alt="output" />;
  }
  if (mime === "image/svg+xml") {
    // Render via a data URL so the SVG can't execute embedded scripts.
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(payload)}`;
    return <img className="nb-output-image" src={src} alt="output" />;
  }
  if (mime === "text/html") {
    // MarkdownContent runs rehype-raw + the shared sanitizer, so embedded HTML
    // is cleaned the same way it is everywhere else in the app.
    return (
      <div className="markdown-body nb-output-html">
        <MarkdownContent content={payload} filePath={filePath} showFrontmatter={false} />
      </div>
    );
  }
  if (mime === "text/markdown") {
    return (
      <div className="markdown-body nb-output-markdown">
        <MarkdownContent content={payload} filePath={filePath} showFrontmatter={false} />
      </div>
    );
  }
  return <AnsiText className="nb-output-text" text={payload} />;
}
