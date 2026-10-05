import { useSettings } from "@/hooks/useSettings";
import type { FilesBlockLayout } from "@/lib/settings";

interface UseFilesBlockLayout extends FilesBlockLayout {
  setHeight: (height: number | null) => void;
  setCollapsed: (collapsed: boolean) => void;
}

/** One Files panel block's saved height and collapsed state, by its layout key. */
export function useFilesBlockLayout(key: string): UseFilesBlockLayout {
  const { settings, updateSettings } = useSettings();
  const blocks = settings.layout.blocks;
  // The store is hand-editable, so a malformed entry falls back to the default.
  const saved = Object.hasOwn(blocks, key) ? blocks[key] : undefined;
  const height = typeof saved?.height === "number" ? saved.height : null;
  const collapsed = saved?.collapsed === true;

  const save = (next: FilesBlockLayout) =>
    updateSettings("layout.blocks", { ...blocks, [key]: next });

  return {
    height,
    collapsed,
    setHeight: (next) => save({ height: next, collapsed }),
    setCollapsed: (next) => save({ height, collapsed: next }),
  };
}
