import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import type { MenuEventHandlers } from "@/hooks/useMenuEvents";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { Command } from "@/lib/commands";
import type { ExporterContribution } from "@/lib/plugins/types";
import { scrollToHeading } from "@/lib/scrollToHeading";
import { useRegistryEntries } from "./usePluginRegistry";

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
  /** Open the plugin management modal. */
  managePlugins: () => void;
  /** Run a plugin-contributed export format through the shared pipeline. */
  runPluginExporter: (exporter: ExporterContribution) => void;
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
  // Optional so the palette keeps working without a PluginsProvider (tests,
  // isolated rendering); both are empty/null in that case.
  const plugins = usePluginsOptional();
  const pluginCommands = useRegistryEntries(plugins?.commands ?? null);
  const pluginExporters = useRegistryEntries(plugins?.exporters ?? null);

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
    // The Help-menu external links (documentation/releaseNotes/reportIssue on
    // AppActions) are intentionally omitted: they belong in the native Help
    // menu only, not the palette.
    out.push(
      {
        id: "cmd:openFile",
        title: t("openFile"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+O",
        run: actions.openFile,
      },
      {
        id: "cmd:openFolder",
        title: t("openFolder"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+Shift+O",
        run: actions.openFolder,
      },
      {
        id: "cmd:closeTab",
        title: t("closeTab"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+W",
        run: actions.closeTab,
      },
      {
        id: "cmd:toggleFilesSidebar",
        title: t("toggleFilesSidebar"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+B",
        run: actions.toggleFilesSidebar,
      },
      {
        id: "cmd:toggleOutlineSidebar",
        title: t("toggleOutlineSidebar"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+\\",
        run: actions.toggleOutlineSidebar,
      },
      { id: "cmd:resetView", title: t("resetView"), section: "Commands", run: actions.resetView },
      {
        id: "cmd:openSettings",
        title: t("openSettings"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+,",
        run: actions.openSettings,
      },
      {
        id: "cmd:openSyncSettings",
        title: t("openSyncSettings"),
        section: "Commands",
        run: actions.openSyncSettings,
      },
      {
        id: "cmd:find",
        title: t("find"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+F",
        run: actions.find,
      },
      {
        id: "cmd:toggleEdit",
        title: t("toggleEdit"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+E",
        run: actions.toggleEdit,
      },
      {
        id: "cmd:openGraph",
        title: t("openGraph"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+G",
        run: actions.openGraph,
      },
      {
        id: "cmd:print",
        title: t("print"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+P",
        run: actions.print,
      },
      {
        id: "cmd:exportHtml",
        title: t("exportHtml"),
        section: "Commands",
        run: actions.exportHtml,
      },
      {
        id: "cmd:exportDocx",
        title: t("exportDocx"),
        section: "Commands",
        run: actions.exportDocx,
      },
      {
        id: "cmd:exportEpub",
        title: t("exportEpub"),
        section: "Commands",
        run: actions.exportEpub,
      },
      { id: "cmd:exportPdf", title: t("exportPdf"), section: "Commands", run: actions.exportPdf },
      {
        id: "cmd:zoomIn",
        title: t("zoomIn"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+=",
        run: actions.zoomIn,
      },
      {
        id: "cmd:zoomOut",
        title: t("zoomOut"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+-",
        run: actions.zoomOut,
      },
      {
        id: "cmd:zoomReset",
        title: t("zoomReset"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+0",
        run: actions.zoomReset,
      },
      {
        id: "cmd:aiChat",
        title: t("aiChat"),
        section: "Commands",
        shortcut: "Cmd/Ctrl+Shift+A",
        run: actions.aiChat,
      },
      { id: "cmd:readAloud", title: t("readAloud"), section: "Commands", run: actions.readAloud },
      {
        id: "cmd:managePlugins",
        title: t("managePlugins"),
        section: "Commands",
        run: actions.managePlugins,
      },
    );

    // Commands contributed by loaded plugins (the marketplace, install, enable,
    // and remove actions all live in the Manage Plugins modal instead).
    for (const c of pluginCommands) {
      out.push({
        id: `plugin:${c.id}`,
        title: c.title,
        section: "Commands",
        run: () => {
          void c.run();
        },
      });
    }

    // Export formats contributed by plugins run through the shared pipeline.
    for (const exporter of pluginExporters) {
      out.push({
        id: `plugin-export:${exporter.id}`,
        title: t("exportAs", { label: exporter.label }),
        section: "Commands",
        run: () => actions.runPluginExporter(exporter),
      });
    }

    return out;
  }, [workspaceOpen, workspaceFiles, tocEntries, actions, t, pluginCommands, pluginExporters]);
}
