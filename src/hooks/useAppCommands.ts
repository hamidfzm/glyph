import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MenuEventHandlers } from "@/hooks/useMenuEvents";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { Command } from "@/lib/commands";
import { scrollToHeading } from "@/lib/scrollToHeading";

export interface AppCommandSources {
  /** True when the window has a folder workspace open. */
  workspaceOpen: boolean;
  /** Markdown files in the workspace, if any. */
  workspaceFiles: readonly string[];
  /** Table-of-contents entries of the active document. */
  tocEntries: readonly TocEntry[];
  /** App-level actions; same shape as the menu handlers plus tab navigation. */
  actions: AppActions;
}

// Reuse the menu handler shape and add the document opener used by Files
// rows. Keeping a single canonical shape means AppShell can pass the same
// `menuHandlers` to both `useMenuEvents` and the palette controller.
export interface AppActions extends MenuEventHandlers {
  /** Open the given workspace file as a document tab. Used by file rows. */
  openWorkspaceFile: (path: string) => void;
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1];
}

/**
 * Build the command-palette command list from the active workspace, the active
 * document outline, and the app's action callbacks. Returns a stable list per
 * input reference; callers should memoise their `actions` object.
 */
export function useAppCommands({
  workspaceOpen,
  workspaceFiles,
  tocEntries,
  actions,
}: AppCommandSources): Command[] {
  const { t } = useTranslation("commands");
  return useMemo<Command[]>(() => {
    const out: Command[] = [];

    // Workspace files — only navigable when a workspace is open.
    if (workspaceOpen) {
      for (const path of workspaceFiles) {
        out.push({
          id: `file:${path}`,
          title: basename(path),
          subtitle: path,
          section: "Files",
          run: () => actions.openWorkspaceFile(path),
        });
      }
    }

    // Active-document headings.
    for (const entry of tocEntries) {
      out.push({
        id: `heading:${entry.id}`,
        title: entry.text,
        subtitle: `H${entry.level}`,
        section: "Headings",
        run: () => scrollToHeading(entry.id),
      });
    }

    // App-level commands. Subset of every menu item that makes sense to invoke
    // from a palette (Open Folder is reachable from the empty-state button).
    // `key` is the stable command id (locale-independent); the visible title is
    // translated via `commands.<key>`.
    const appCommands: Array<{ key: string; shortcut?: string; run: () => void }> = [
      { key: "openFile", shortcut: "Cmd/Ctrl+O", run: actions.openFile },
      { key: "openFolder", shortcut: "Cmd/Ctrl+Shift+O", run: actions.openFolder },
      { key: "closeTab", shortcut: "Cmd/Ctrl+W", run: actions.closeTab },
      { key: "toggleFilesSidebar", shortcut: "Cmd/Ctrl+B", run: actions.toggleFilesSidebar },
      { key: "toggleOutlineSidebar", shortcut: "Cmd/Ctrl+\\", run: actions.toggleOutlineSidebar },
      { key: "resetView", run: actions.resetView },
      { key: "openSettings", shortcut: "Cmd/Ctrl+,", run: actions.openSettings },
      { key: "openSyncSettings", run: actions.openSyncSettings },
      { key: "find", shortcut: "Cmd/Ctrl+F", run: actions.find },
      { key: "toggleEdit", shortcut: "Cmd/Ctrl+E", run: actions.toggleEdit },
      { key: "openGraph", shortcut: "Cmd/Ctrl+G", run: actions.openGraph },
      { key: "print", shortcut: "Cmd/Ctrl+P", run: actions.print },
      { key: "exportHtml", run: actions.exportHtml },
      { key: "exportDocx", run: actions.exportDocx },
      { key: "exportEpub", run: actions.exportEpub },
      { key: "exportPdf", run: actions.exportPdf },
      { key: "zoomIn", shortcut: "Cmd/Ctrl+=", run: actions.zoomIn },
      { key: "zoomOut", shortcut: "Cmd/Ctrl+-", run: actions.zoomOut },
      { key: "zoomReset", shortcut: "Cmd/Ctrl+0", run: actions.zoomReset },
      { key: "readAloud", run: actions.readAloud },
    ];
    for (const c of appCommands) {
      out.push({
        id: `cmd:${c.key}`,
        title: t(c.key),
        section: "Commands",
        shortcut: c.shortcut,
        run: c.run,
      });
    }

    return out;
  }, [workspaceOpen, workspaceFiles, tocEntries, actions, t]);
}
