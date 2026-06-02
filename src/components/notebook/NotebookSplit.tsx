import { NotebookSource } from "./NotebookSource";
import { NotebookViewer } from "./NotebookViewer";

interface NotebookSplitProps {
  /** Raw `.ipynb` JSON text. */
  content: string;
  filePath?: string;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
}

// Split view for a notebook: raw `.ipynb` JSON on the left, rendered cells on
// the right — both read-only (notebooks can't be edited in Glyph). Mirrors the
// markdown SplitView's source-left / rendered-right layout so the toggle feels
// consistent. Search and scroll tracking attach to the rendered pane, which is
// the primary content; the JSON pane scrolls independently.
export function NotebookSplit({
  content,
  filePath,
  initialScrollTop,
  onScrollChange,
  searchOpen,
  onSearchClose,
}: NotebookSplitProps) {
  return (
    <div className="split-view flex h-full w-full">
      <div className="split-view-editor flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden border-r border-[var(--color-border)]">
        <NotebookSource
          content={content}
          filePath={filePath}
          searchOpen={false}
          onSearchClose={onSearchClose}
          banner="Source (read-only)"
        />
      </div>
      <div className="split-view-preview flex flex-1 min-w-0 min-h-0 overflow-hidden">
        <NotebookViewer
          content={content}
          filePath={filePath}
          initialScrollTop={initialScrollTop}
          onScrollChange={onScrollChange}
          searchOpen={searchOpen}
          onSearchClose={onSearchClose}
        />
      </div>
    </div>
  );
}
