import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { canvasColorToCss } from "@/lib/canvas/color";
import type { CanvasNode } from "@/lib/canvas/types";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

interface CanvasNodeViewProps {
  node: CanvasNode;
  /** Absolute path of the .canvas file, for resolving relative file refs. */
  canvasPath?: string;
  /** Open an embedded file node in the workspace (folder tabs only). */
  onOpenFile?: (path: string) => void;
  /**
   * When false (the editor), link/file cards render inert: clicking selects
   * and drags the card instead of opening the URL or embedded file.
   * Defaults to true (the read-only viewer).
   */
  interactive?: boolean;
}

/** Resolve a canvas-relative file reference against the .canvas file's folder. */
function resolveRelative(file: string, canvasPath: string | undefined): string {
  if (!canvasPath) return file;
  const dir = canvasPath.replace(/[/\\][^/\\]*$/, "");
  return `${dir}/${file}`.replace(/\/\.\//g, "/");
}

// Renders the inner content of a single canvas node by type. Positioning,
// borders, and selection chrome are applied by the parent layer; this component
// owns only what goes *inside* the card.
export function CanvasNodeView({
  node,
  canvasPath,
  onOpenFile,
  interactive = true,
}: CanvasNodeViewProps) {
  const accent = canvasColorToCss(node.color);

  switch (node.type) {
    case "text":
      return (
        // markdown-body opts the card into the full document styling
        // (headings, lists, code blocks); canvas.css strips its page chrome.
        <div className="glyph-canvas-node-text markdown-body">
          <MarkdownContent content={node.text} filePath={canvasPath} showFrontmatter={false} />
        </div>
      );

    case "link": {
      const label = <span className="glyph-canvas-node-link-url">{node.url}</span>;
      if (!interactive) {
        return (
          <div className="glyph-canvas-node-link" title={node.url}>
            {label}
          </div>
        );
      }
      return (
        <button
          type="button"
          className="glyph-canvas-node-link"
          onClick={() => void openUrl(node.url)}
          title={node.url}
        >
          {label}
        </button>
      );
    }

    case "file": {
      const resolved = resolveRelative(node.file, canvasPath);
      if (IMAGE_EXT.test(node.file)) {
        return (
          <img
            className="glyph-canvas-node-image"
            src={convertFileSrc(resolved)}
            alt={
              // v8 ignore next -- defensive: split of a matched image path always yields a basename
              node.file.split(/[/\\]/).pop() ?? node.file
            }
          />
        );
      }
      const name = (
        <span className="glyph-canvas-node-file-name">{node.file.split(/[/\\]/).pop()}</span>
      );
      if (!interactive) {
        return (
          <div className="glyph-canvas-node-file" title={node.file}>
            {name}
          </div>
        );
      }
      return (
        <button
          type="button"
          className="glyph-canvas-node-file"
          onClick={() => onOpenFile?.(node.file)}
          title={node.file}
        >
          {name}
        </button>
      );
    }

    case "group":
      return (
        <div
          className="glyph-canvas-node-group-label"
          style={accent ? { color: accent } : undefined}
        >
          {node.label}
        </div>
      );
  }
}
