import { useCallback, useMemo, useState } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { isPathInside } from "@/lib/paths";
import { pickExportDir } from "@/lib/pickers";

export interface SiteExportProgress {
  done: number;
  total: number;
}

export interface ExportSiteHandlers {
  /** File > Export > Website: pick an output folder and export the workspace. */
  exportWebsite: () => Promise<void>;
  /** Non-null while an export runs; drives the determinate progress toast. */
  siteProgress: SiteExportProgress | null;
}

/**
 * Export the active folder workspace as a static website. Shows a native
 * folder picker for the destination, then renders every markdown file
 * headlessly (no dependence on what is open on screen) with per-file progress.
 * No-op without a workspace; the menu item is also disabled then.
 */
export function useExportSite(root: string | undefined): ExportSiteHandlers {
  const [siteProgress, setSiteProgress] = useState<SiteExportProgress | null>(null);
  // Plugin-contributed site themes; empty without a PluginsProvider (tests).
  const plugins = usePluginsOptional();
  const pluginThemes = useRegistryEntries(plugins?.siteThemes ?? null);

  const exportWebsite = useCallback(async () => {
    if (!root) return;
    const outDir = await pickExportDir();
    if (typeof outDir !== "string" || outDir === "") return; // cancelled
    if (isPathInside(outDir, root)) {
      // Exporting into the watched workspace would pollute it (and re-export
      // its own output next time). Surfaced as a console error like the other
      // export failure paths.
      console.error("Website export destination cannot be inside the workspace.");
      return;
    }
    setSiteProgress({ done: 0, total: 0 });
    try {
      // Heavy render pipeline loads only when the user actually exports.
      const { exportSite } = await import("@/lib/export/site/exportSite");
      await exportSite({
        root,
        outDir,
        themes: pluginThemes,
        onProgress: (done, total) => setSiteProgress({ done, total }),
      });
    } catch (err) {
      console.error("Failed to export website:", err);
    } finally {
      setSiteProgress(null);
    }
  }, [root, pluginThemes]);

  return useMemo(() => ({ exportWebsite, siteProgress }), [exportWebsite, siteProgress]);
}
