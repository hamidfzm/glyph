import { useCallback, useRef, useState } from "react";

/**
 * How an export ended when it did not simply succeed: refused before it
 * started, failed part way, or (a website) written in full with its cleanup
 * failing. `reason` is what the export reported, shown as written (it is not
 * translated).
 */
export type ExportNoticeContent =
  | { kind: "insideWorkspace" }
  | { kind: "failed" | "siteFailed" | "pruneFailed"; reason: string };

export interface ExportNoticeActions {
  showNotice: (notice: ExportNoticeContent) => void;
  /**
   * Call when an export is asked for, and call what it returns once that export
   * starts writing. It drops the notice that was up when the user asked, and
   * leaves one that another export raised while the dialog was open.
   */
  captureSeenNotice: () => () => void;
}

interface ExportNoticeState extends ExportNoticeActions {
  /** Stays up until dismissed, replaced, or dropped by the user's next export. */
  notice: ExportNoticeContent | null;
  dismissNotice: () => void;
}

/**
 * The one notice the document, plugin and website exports share. The actions
 * keep their identity while the notice changes, so the export handlers built
 * on them (and the menu subscription built on those) are not rebuilt.
 */
export function useExportNotice(): ExportNoticeState {
  const [notice, setNotice] = useState<ExportNoticeContent | null>(null);
  // Mirrors `notice` so the actions can read it without depending on it.
  const shownRef = useRef<ExportNoticeContent | null>(null);

  const setShown = useCallback((next: ExportNoticeContent | null) => {
    shownRef.current = next;
    setNotice(next);
  }, []);
  const dismissNotice = useCallback(() => setShown(null), [setShown]);
  const captureSeenNotice = useCallback(() => {
    const seen = shownRef.current;
    return () => {
      if (shownRef.current === seen) setShown(null);
    };
  }, [setShown]);

  return { notice, showNotice: setShown, dismissNotice, captureSeenNotice };
}
