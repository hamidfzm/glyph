import { EDITOR_MODE } from "@/lib/settings";
import type { FileState } from "@/lib/tabs";
import { CanvasEditor, CanvasViewer } from "./canvas/lazyCanvas";

interface CanvasPaneProps {
  tabId: string;
  file: FileState;
  /** The live edit buffer when there is one, so switching back to view right
   *  after an edit shows the latest board instead of the last autosaved one. */
  content: string;
  onOpenFile: (path: string) => void;
  onChange: (serialized: string) => void;
}

// Canvas files (JSON Canvas spec) render on an infinite pan/zoom board rather
// than as text. View mode is the read-only board; edit mode is the full editor
// (the split button is hidden for canvas — the board IS the editor). The
// serialized JSON never flows through the markdown editor; edits are committed
// straight to the tab content pipeline via commitEdit.
export function CanvasPane({ tabId, file, content, onOpenFile, onChange }: CanvasPaneProps) {
  const key = `${tabId}:${file.path}`;
  if (file.mode === EDITOR_MODE.view) {
    return (
      <CanvasViewer
        key={key}
        content={content}
        filePath={file.path}
        onOpenFile={onOpenFile}
        onChange={onChange}
        viewportKey={key}
      />
    );
  }
  return (
    <CanvasEditor
      key={key}
      content={content}
      filePath={file.path}
      onChange={onChange}
      viewportKey={key}
    />
  );
}
