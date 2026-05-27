import { useMemo } from "react";
import type { Platform } from "@/hooks/usePlatform";
import type { TocEntry } from "@/hooks/useTableOfContents";
import type { FolderTab } from "@/hooks/useTabs";
import type { Command } from "@/lib/commands";
import { type AppActions, useAppCommands } from "./useAppCommands";
import { useCommandPalette } from "./useCommandPalette";

interface UseCommandPaletteControllerOptions {
  platform: Platform;
  activeFolderTab: FolderTab | null;
  workspaceFiles: readonly string[];
  tocEntries: readonly TocEntry[];
  /** App-level callbacks, e.g. the menu-handler object. */
  actions: AppActions;
  /** Mirror of `settings.experimental.cloudSync`. */
  cloudSyncEnabled: boolean;
}

export interface CommandPaletteController {
  open: boolean;
  query: string;
  setQuery: (next: string) => void;
  close: () => void;
  commands: readonly Command[];
}

/**
 * Composes the keyboard-driven palette state (`useCommandPalette`) with the
 * command-source builder (`useAppCommands`). One hook call from AppShell.
 */
export function useCommandPaletteController({
  platform,
  activeFolderTab,
  workspaceFiles,
  tocEntries,
  actions,
  cloudSyncEnabled,
}: UseCommandPaletteControllerOptions): CommandPaletteController {
  const palette = useCommandPalette({ platform });
  const commands = useAppCommands({
    activeFolderTab,
    workspaceFiles,
    tocEntries,
    actions,
    cloudSyncEnabled,
  });

  return useMemo(
    () => ({
      open: palette.open,
      query: palette.query,
      setQuery: palette.setQuery,
      close: palette.closePalette,
      commands,
    }),
    [palette.open, palette.query, palette.setQuery, palette.closePalette, commands],
  );
}
