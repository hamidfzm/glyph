import { useMemo } from "react";
import type { MenuEventHandlers } from "@/hooks/useMenuEvents";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { FolderTab } from "@/hooks/useTabs";
import type { Command } from "@/lib/commands";
import { scrollToHeading } from "@/lib/scrollToHeading";

export interface AppCommandSources {
  /** Active folder tab (for opening workspace files inside it). */
  activeFolderTab: FolderTab | null;
  /** Markdown files in the active workspace, if any. */
  workspaceFiles: readonly string[];
  /** Table-of-contents entries of the active document. */
  tocEntries: readonly TocEntry[];
  /** App-level actions; same shape as the menu handlers plus tab navigation. */
  actions: AppActions;
  /** Mirror of `settings.experimental.cloudSync`. Gates the "Cloud Sync…" entry. */
  cloudSyncEnabled: boolean;
}

// Reuse the menu handler shape and add the folder-tab navigator used by Files
// rows. Keeping a single canonical shape means AppShell can pass the same
// `menuHandlers` to both `useMenuEvents` and the palette controller.
export interface AppActions extends MenuEventHandlers {
  /** Open the given workspace file in a folder tab. Used by file-source rows. */
  openFileInFolderTab: (tabId: string, path: string) => void;
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
  activeFolderTab,
  workspaceFiles,
  tocEntries,
  actions,
  cloudSyncEnabled,
}: AppCommandSources): Command[] {
  return useMemo<Command[]>(() => {
    const out: Command[] = [];

    // Workspace files — only navigable when a folder tab is active.
    if (activeFolderTab) {
      const folderId = activeFolderTab.id;
      for (const path of workspaceFiles) {
        out.push({
          id: `file:${path}`,
          title: basename(path),
          subtitle: path,
          section: "Files",
          run: () => actions.openFileInFolderTab(folderId, path),
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
    const appCommands: Array<{ title: string; shortcut?: string; run: () => void }> = [
      { title: "Open File…", shortcut: "Cmd/Ctrl+O", run: actions.openFile },
      { title: "Open Folder…", shortcut: "Cmd/Ctrl+Shift+O", run: actions.openFolder },
      { title: "Close Tab", shortcut: "Cmd/Ctrl+W", run: actions.closeTab },
      { title: "Toggle Files Sidebar", shortcut: "Cmd/Ctrl+B", run: actions.toggleFilesSidebar },
      {
        title: "Toggle Outline Sidebar",
        shortcut: "Cmd/Ctrl+\\",
        run: actions.toggleOutlineSidebar,
      },
      { title: "Reset View", run: actions.resetView },
      { title: "Settings…", shortcut: "Cmd/Ctrl+,", run: actions.openSettings },
      // Hidden when the experimental.cloudSync flag is off so the palette
      // never surfaces a command that's been disabled at every other layer.
      ...(cloudSyncEnabled ? [{ title: "Cloud Sync…", run: actions.openSyncSettings }] : []),
      { title: "Find in Document", shortcut: "Cmd/Ctrl+F", run: actions.find },
      { title: "Toggle Edit Mode", shortcut: "Cmd/Ctrl+E", run: actions.toggleEdit },
      { title: "Print…", shortcut: "Cmd/Ctrl+P", run: actions.print },
      { title: "Export to HTML…", run: actions.exportHtml },
      { title: "Export to Word (DOCX)…", run: actions.exportDocx },
      { title: "Export to EPUB…", run: actions.exportEpub },
      { title: "Export to PDF…", run: actions.exportPdf },
      { title: "Zoom In", shortcut: "Cmd/Ctrl+=", run: actions.zoomIn },
      { title: "Zoom Out", shortcut: "Cmd/Ctrl+-", run: actions.zoomOut },
      { title: "Reset Zoom", shortcut: "Cmd/Ctrl+0", run: actions.zoomReset },
      { title: "Read Aloud", run: actions.readAloud },
    ];
    for (const c of appCommands) {
      out.push({
        id: `cmd:${c.title}`,
        title: c.title,
        section: "Commands",
        shortcut: c.shortcut,
        run: c.run,
      });
    }

    return out;
  }, [activeFolderTab, workspaceFiles, tocEntries, actions, cloudSyncEnabled]);
}
