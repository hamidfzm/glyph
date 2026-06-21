import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { fenceCode } from "@/lib/notebook/fence";
import { MarkdownViewer } from "../markdown/MarkdownViewer";

interface NotebookSourceProps {
  /** Raw `.ipynb` JSON text. */
  content: string;
  filePath?: string;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
  /**
   * Banner text shown above the source. Defaults to the standalone "read-only"
   * note; the split view passes a shorter pane label since the rendered pane
   * beside it already makes the read-only intent obvious. Pass `null` to hide.
   */
  banner?: string | null;
}

// Read-only view of a notebook's raw `.ipynb` JSON, shown when a notebook tab
// is switched into edit/split mode. Notebooks are not editable in Glyph (see
// the issue's read-only scope), so rather than dropping the JSON into the
// markdown editor — which would let autosave write malformed content back and
// corrupt the file — we render it as a syntax-highlighted JSON code block
// through the standard viewer. That reuses highlighting, the copy button, and
// in-document search for free, with no write path.
export function NotebookSource({
  content,
  filePath,
  initialScrollTop,
  onScrollChange,
  searchOpen,
  onSearchClose,
  banner,
}: NotebookSourceProps) {
  const { t } = useTranslation("common");
  const fenced = useMemo(() => fenceCode(content, "json"), [content]);
  // Default to the standalone read-only note; `null` hides the banner entirely.
  const bannerText = banner === null ? null : (banner ?? t("notebook.sourceBanner"));

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {bannerText !== null && (
        <div className="nb-source-banner" data-print-hide="true">
          {bannerText}
        </div>
      )}
      <MarkdownViewer
        content={fenced}
        filePath={filePath}
        initialScrollTop={initialScrollTop}
        onScrollChange={onScrollChange}
        searchOpen={searchOpen}
        onSearchClose={onSearchClose}
      />
    </div>
  );
}
