import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useRef } from "react";
import { MarkdownContent } from "@/components/markdown/MarkdownContent";
import { resolveImageSrc } from "@/components/markdown/resolveImageSrc";
import { useWorkspaceRoot } from "@/contexts/WorkspaceRootContext";
import { canvasColorToCss } from "@/lib/canvas/color";
import type { CanvasNode } from "@/lib/canvas/types";
import { isPathInside } from "@/lib/paths";
import { normalizeRelativePath } from "@/lib/relativePath";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

interface CanvasNodeViewProps {
  node: CanvasNode;
  /** Absolute path of the .canvas file, for resolving relative file refs. */
  canvasPath?: string;
  /** Open an embedded file node in the workspace, by absolute path. */
  onOpenFile?: (path: string) => void;
  /**
   * When false (the editor), link/file cards render inert: clicking selects
   * and drags the card instead of opening the URL or embedded file.
   * Defaults to true (the read-only viewer).
   */
  interactive?: boolean;
  /** Toggle a task-list checkbox at a 1-based line within this card's text. */
  onTaskToggle?: (line: number) => void;
}

/** Resolve a canvas-relative file reference against the .canvas file's folder. */
function resolveRelative(file: string, canvasPath: string | undefined): string {
  return canvasPath ? normalizeRelativePath(canvasPath, file) : file;
}

/** The display name of a file reference: its basename. */
function fileBasename(file: string): string {
  return file.split(/[/\\]/).pop() ?? file;
}

// Renders the inner content of a single canvas node by type. Positioning,
// borders, and selection chrome are applied by the parent layer; this component
// owns only what goes *inside* the card.
export function CanvasNodeView({
  node,
  canvasPath,
  onOpenFile,
  interactive = true,
  onTaskToggle,
}: CanvasNodeViewProps) {
  const workspaceRoot = useWorkspaceRoot();
  const accent = canvasColorToCss(node.color);

  // The toggle handler must keep a stable identity: parents rebuild their
  // per-node closures every render, and MarkdownContent remounts the whole
  // markdown DOM when its onTaskToggle identity changes — replacing the
  // checkbox between pointerdown (which selects the card and re-renders) and
  // mouseup, so the click would never fire.
  const taskToggleRef = useRef(onTaskToggle);
  taskToggleRef.current = onTaskToggle;
  const stableTaskToggle = useCallback((line: number) => taskToggleRef.current?.(line), []);

  switch (node.type) {
    case "text":
      return (
        // markdown-body opts the card into the full document styling
        // (headings, lists, code blocks); canvas.css strips its page chrome.
        // workspaceRoot/onOpenRelativeFile are intentionally not threaded here:
        // relative-link opening is a document-tab affordance; embedded canvas
        // text cards render their markdown inline without in-app navigation.
        <div className="glyph-canvas-node-text markdown-body">
          <MarkdownContent
            content={node.text}
            filePath={canvasPath}
            showFrontmatter={false}
            onTaskToggle={onTaskToggle ? stableTaskToggle : undefined}
          />
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
      // A file ref that resolves outside the opened workspace is refused: the
      // image isn't loaded and the open button degrades to an inert card. With
      // no canvasPath, `resolved` is the raw relative ref, which `isPathInside`
      // correctly reports as outside the root, so it's refused too.
      const outsideRoot = !!workspaceRoot && !isPathInside(resolved, workspaceRoot);

      if (IMAGE_EXT.test(node.file)) {
        const src = resolveImageSrc(node.file, canvasPath, workspaceRoot);
        if (!src) {
          return (
            <div className="glyph-canvas-node-file" title={node.file}>
              <span className="glyph-canvas-node-file-name">{fileBasename(node.file)}</span>
            </div>
          );
        }
        return <img className="glyph-canvas-node-image" src={src} alt={fileBasename(node.file)} />;
      }
      const name = <span className="glyph-canvas-node-file-name">{fileBasename(node.file)}</span>;
      if (!interactive || outsideRoot) {
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
          onClick={() => onOpenFile?.(resolved)}
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
