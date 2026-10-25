import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useRef } from "react";
import type { ExportNoticeContent } from "@/hooks/useExportNotice";
import { canShareLink, shareLinkFor } from "@/lib/shareLink";
import { type FileState, liveContentOf } from "@/lib/tabs";

interface ShareLinkOptions {
  file: FileState | null | undefined;
  showNotice: (notice: ExportNoticeContent) => void;
}

/**
 * Copy a web viewer link carrying the active document as shown, unsaved edits
 * included. It goes through the clipboard plugin: a native menu click carries
 * no user activation, and WebKit's clipboard API refuses a write without one.
 */
export function useShareLink({ file, showNotice }: ShareLinkOptions): () => void {
  // Only the newest request writes, so a slow encode never replaces a newer link.
  const latest = useRef(0);
  return useCallback(() => {
    const content = canShareLink(file) ? liveContentOf(file) : null;
    if (content === null) return;
    const id = ++latest.current;
    const report = (notice: ExportNoticeContent) => {
      if (id === latest.current) showNotice(notice);
    };
    shareLinkFor(content)
      .then(async (link) => {
        if (id !== latest.current) return;
        if (link === null) {
          report({ kind: "linkTooLong" });
          return;
        }
        await writeText(link);
        report({ kind: "linkCopied" });
      })
      .catch(() => report({ kind: "linkFailed" }));
  }, [file, showNotice]);
}
