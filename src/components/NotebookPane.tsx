import { EDITOR_MODE, type EditorMode } from "@/lib/settings";
import type { FileState } from "@/lib/tabs";
import { NotebookSource, NotebookSplit, NotebookViewer } from "./notebook/lazyNotebook";

interface NotebookPaneProps {
  tabId: string;
  file: FileState;
  /** The loaded document; the caller has already ruled out the null state. */
  content: string;
  /** Already resolved against the viewport (see effectiveEditorMode). */
  mode: EditorMode;
  searchOpen: boolean;
  onSearchClose: () => void;
  onScrollChange: (scrollTop: number) => void;
}

// Notebooks are read-only, so the three modes map to read-only views rather
// than editors: view = rendered cells, split = cells + raw JSON side by side,
// edit = raw JSON source. None drop the JSON into the markdown editor, which
// would let autosave write malformed content back and corrupt the file.
export function NotebookPane({
  tabId,
  file,
  content,
  mode,
  searchOpen,
  onSearchClose,
  onScrollChange,
}: NotebookPaneProps) {
  const NotebookComponent =
    mode === EDITOR_MODE.view
      ? NotebookViewer
      : mode === EDITOR_MODE.split
        ? NotebookSplit
        : NotebookSource;
  return (
    <NotebookComponent
      key={`${tabId}:${file.path}`}
      content={content}
      filePath={file.path}
      initialScrollTop={file.scrollTop}
      onScrollChange={onScrollChange}
      searchOpen={searchOpen}
      onSearchClose={onSearchClose}
    />
  );
}
