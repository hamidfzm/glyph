import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useRef } from "react";
import type { ExportNoticeContent } from "@/hooks/useExportNotice";
import { errorMessage } from "@/lib/errorMessage";
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
  // Only the newest request writes or reports, so a slow encode never replaces
  // a newer link.
  const latest = useRef(0);
  // Writes run one at a time: two plugin calls in flight can land in either order.
  const writes = useRef<Promise<void>>(Promise.resolve());
  return useCallback(() => {
    const content = canShareLink(file) ? liveContentOf(file) : null;
    if (content === null) return;
    const id = ++latest.current;
    const isLatest = () => id === latest.current;
    const report = (notice: ExportNoticeContent) => {
      if (isLatest()) showNotice(notice);
    };
    shareLinkFor(content)
      .then(async (link) => {
        if (!isLatest()) return;
        if (link === null) {
          report({ kind: "linkTooLong" });
          return;
        }
        const write = writes.current.then(() => (isLatest() ? writeText(link) : undefined));
        writes.current = write.catch(() => undefined);
        await write;
        report({ kind: "linkCopied" });
      })
      .catch((err: unknown) => report({ kind: "linkFailed", reason: errorMessage(err) }));
  }, [file, showNotice]);
}
