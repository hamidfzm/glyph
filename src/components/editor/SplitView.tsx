import { useEffect, useRef, useState } from "react";
import { MarkdownViewer } from "../markdown/MarkdownViewer";
import { MarkdownEditor } from "./MarkdownEditor";

interface SplitViewProps {
  content: string;
  filePath?: string;
  onChange: (content: string) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
  workspaceFiles?: string[];
  workspaceRoot?: string;
  onOpenWikilink?: (path: string, heading?: string) => void;
}

const PREVIEW_DEBOUNCE = 300;

export function SplitView({
  content,
  filePath,
  onChange,
  searchOpen,
  onSearchClose,
  workspaceFiles,
  workspaceRoot,
  onOpenWikilink,
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

  return (
    <div className="split-view">
      <div className="split-view-editor">
        <MarkdownEditor
          content={content}
          onChange={handleChange}
          workspaceFiles={workspaceFiles}
          workspaceRoot={workspaceRoot}
        />
      </div>
      <div className="split-view-preview">
        <MarkdownViewer
          content={previewContent}
          filePath={filePath}
          searchOpen={searchOpen}
          onSearchClose={onSearchClose}
          workspaceFiles={workspaceFiles}
          onOpenWikilink={onOpenWikilink}
        />
      </div>
    </div>
  );
}
