import { useCallback, useMemo, useRef, useState } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import type { ExportNoticeActions } from "@/hooks/useExportNotice";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { errorMessage } from "@/lib/errorMessage";
import { isPathInside } from "@/lib/paths";
import { pickExportDir } from "@/lib/pickers";

export interface SiteExportProgress {
  done: number;
  total: number;
}

interface UseExportSiteOptions extends ExportNoticeActions {
  root: string | undefined;
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
 * An export that is refused, fails, or cannot clean up after itself says so in
 * the export notice. No-op without a workspace; the menu item is also disabled
 * then.
 */
export function useExportSite({
  root,
  showNotice,
  captureSeenNotice,
}: UseExportSiteOptions): ExportSiteHandlers {
  const [siteProgress, setSiteProgress] = useState<SiteExportProgress | null>(null);
  // One export at a time: the first one ending would hide the second's progress.
  const isExportingRef = useRef(false);
  // Plugin contributions; empty without a PluginsProvider (tests).
  const plugins = usePluginsOptional();
  const pluginThemes = useRegistryEntries(plugins?.siteThemes ?? null);
  const remarkPlugins = useRegistryEntries(plugins?.remarkPlugins ?? null);
  const rehypePlugins = useRegistryEntries(plugins?.rehypePlugins ?? null);

  const exportWebsite = useCallback(async () => {
    if (!root || isExportingRef.current) return;
    isExportingRef.current = true;
    const dropSeenNotice = captureSeenNotice();
    try {
      const outDir = await pickExportDir();
      if (typeof outDir !== "string" || outDir === "") return; // cancelled
      if (isPathInside(outDir, root)) {
        // Exporting into the watched workspace would pollute it (and re-export
        // its own output next time).
        showNotice({ kind: "insideWorkspace" });
        return;
      }
      dropSeenNotice();
      setSiteProgress({ done: 0, total: 0 });
      // Heavy render pipeline loads only when the user actually exports.
      const { exportSite } = await import("@/lib/export/site/exportSite");
      const { pruneError } = await exportSite({
        root,
        outDir,
        themes: pluginThemes,
        // Plugin markdown syntax renders in the export as it does in the viewer.
        remarkPlugins,
        rehypePlugins,
        onProgress: (done, total) => setSiteProgress({ done, total }),
      });
      if (pruneError !== null) showNotice({ kind: "pruneFailed", reason: pruneError });
    } catch (err) {
      console.error("Failed to export website:", err);
      showNotice({ kind: "siteFailed", reason: errorMessage(err) });
    } finally {
      isExportingRef.current = false;
      setSiteProgress(null);
    }
  }, [root, pluginThemes, remarkPlugins, rehypePlugins, showNotice, captureSeenNotice]);

  return useMemo(() => ({ exportWebsite, siteProgress }), [exportWebsite, siteProgress]);
}
