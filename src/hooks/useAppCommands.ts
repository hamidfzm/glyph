import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileTextIcon } from "@/components/icons/FileTextIcon";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import type { MenuEventHandlers } from "@/hooks/useMenuEvents";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { appPaletteCommands } from "@/lib/appPaletteCommands";
import type { Command } from "@/lib/commands";
import { basename } from "@/lib/paths";
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
  /** Open Workspace Settings on the Cloud Sync tab. Palette-only: the status
   *  bar's sync pill is the other entry point, and there is no menu item. */
  openSyncSettings: () => void;
  /** Run a plugin-contributed export format through the shared pipeline. */
  runPluginExporter: (exporter: ExporterContribution) => void;
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
          path,
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

    out.push(...appPaletteCommands(t, actions, workspaceOpen));

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
        icon: FileTextIcon,
        run: () => actions.runPluginExporter(exporter),
      });
    }

    return out;
  }, [workspaceOpen, workspaceFiles, tocEntries, actions, t, pluginCommands, pluginExporters]);
}
