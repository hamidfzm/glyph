import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { canvasColorToCss } from "@/lib/canvas/color";
import type { CanvasNode } from "@/lib/canvas/types";
import { MarkdownContent } from "../markdown/MarkdownContent";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

interface CanvasNodeViewProps {
  node: CanvasNode;
  /** Absolute path of the .canvas file, for resolving relative file refs. */
  canvasPath?: string;
  /** Open an embedded file node in the workspace (folder tabs only). */
  onOpenFile?: (path: string) => void;
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
export function CanvasNodeView({ node, canvasPath, onOpenFile }: CanvasNodeViewProps) {
  const accent = canvasColorToCss(node.color);

  switch (node.type) {
    case "text":
      return (
        <div className="glyph-canvas-node-text">
          <MarkdownContent content={node.text} filePath={canvasPath} showFrontmatter={false} />
        </div>
      );

    case "link":
      return (
        <button
          type="button"
          className="glyph-canvas-node-link"
          onClick={() => void openUrl(node.url)}
          title={node.url}
        >
          <span className="glyph-canvas-node-link-url">{node.url}</span>
        </button>
      );

    case "file": {
      const resolved = resolveRelative(node.file, canvasPath);
      if (IMAGE_EXT.test(node.file)) {
        return (
          <img
            className="glyph-canvas-node-image"
            src={convertFileSrc(resolved)}
            alt={node.file.split(/[/\\]/).pop() ?? node.file}
          />
        );
      }
      return (
        <button
          type="button"
          className="glyph-canvas-node-file"
          onClick={() => onOpenFile?.(node.file)}
          title={node.file}
        >
          <span className="glyph-canvas-node-file-name">{node.file.split(/[/\\]/).pop()}</span>
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
