import { useEffect, useRef, useState } from "react";
import { MarkdownViewer } from "@/components/markdown/MarkdownViewer";
import { MarkdownEditor } from "./MarkdownEditor";

interface SplitViewProps {
  content: string;
  filePath?: string;
  onChange: (content: string) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
  workspaceFiles?: string[];
  onOpenWikilink?: (path: string, heading?: string) => void;
  onOpenRelativeFile?: (path: string) => void;
  onTaskToggle?: (line: number) => void;
}

const PREVIEW_DEBOUNCE = 300;

export function SplitView({
  content,
  filePath,
  onChange,
  searchOpen,
  onSearchClose,
  workspaceFiles,
  onOpenWikilink,
  onOpenRelativeFile,
  onTaskToggle,
}: SplitViewProps) {
  const [previewContent, setPreviewContent] = useState(content);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = (newContent: string) => {
    onChange(newContent);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPreviewContent(newContent);
    }, PREVIEW_DEBOUNCE);
  };

  // Sync preview when content changes from outside (e.g., initial load)
  useEffect(() => {
    setPreviewContent(content);
  }, [content]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // The preview wrapper must be a flex column with `min-h-0` so that the
  // inner MarkdownViewer (which sizes itself with `flex-1` and positions its
  // scroll layer absolutely) gets a real height. A plain block parent
  // collapses to 0px and the preview renders empty.
  return (
    <div className="split-view flex h-full w-full">
      <div
        data-testid="split-view-editor"
        className="split-view-editor flex flex-1 min-w-0 min-h-0 overflow-hidden border-r border-[var(--color-border)]"
      >
        <MarkdownEditor content={content} onChange={handleChange} workspaceFiles={workspaceFiles} />
      </div>
      <div
        data-testid="split-view-preview"
        className="split-view-preview flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
      >
        <MarkdownViewer
          content={previewContent}
          filePath={filePath}
          searchOpen={searchOpen}
          onSearchClose={onSearchClose}
          workspaceFiles={workspaceFiles}
          onOpenWikilink={onOpenWikilink}
          onOpenRelativeFile={onOpenRelativeFile}
          onTaskToggle={onTaskToggle}
        />
      </div>
    </div>
  );
}
