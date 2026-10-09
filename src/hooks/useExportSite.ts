import { useCallback, useMemo, useRef, useState } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { errorMessage } from "@/lib/errorMessage";
import { pickExportDir } from "@/lib/pickers";

export interface SiteExportProgress {
  done: number;
  total: number;
}

/**
 * How a website export ended when it did not simply succeed: refused before
 * it started, failed part way, or written in full with its cleanup failing.
 * `reason` is what the export reported, shown as written (it is not translated).
 */
export type SiteExportNotice =
  | { kind: "insideWorkspace" }
  | { kind: "failed" | "pruneFailed"; reason: string };

export interface ExportSiteHandlers {
  /** File > Export > Website: pick an output folder and export the workspace. */
  exportWebsite: () => Promise<void>;
  /** Non-null while an export runs; drives the determinate progress toast. */
  siteProgress: SiteExportProgress | null;
  /** Stays up until dismissed or the next export starts. */
  siteNotice: SiteExportNotice | null;
  dismissSiteNotice: () => void;
}

/**
 * Export the active folder workspace as a static website. Shows a native
 * folder picker for the destination, then renders every markdown file
 * headlessly (no dependence on what is open on screen) with per-file progress.
 * No-op without a workspace; the menu item is also disabled then.
 */
export function useExportSite(root: string | undefined): ExportSiteHandlers {
  const [siteProgress, setSiteProgress] = useState<SiteExportProgress | null>(null);
  const [siteNotice, setSiteNotice] = useState<SiteExportNotice | null>(null);
  // One export at a time: a second one starting would clear the first one's
  // notice before it was read, and the first one ending would hide its progress.
  const isExportingRef = useRef(false);
  // Plugin contributions; empty without a PluginsProvider (tests).
  const plugins = usePluginsOptional();
  const pluginThemes = useRegistryEntries(plugins?.siteThemes ?? null);
  const remarkPlugins = useRegistryEntries(plugins?.remarkPlugins ?? null);
  const rehypePlugins = useRegistryEntries(plugins?.rehypePlugins ?? null);

  const exportWebsite = useCallback(async () => {
    if (!root || isExportingRef.current) return;
    isExportingRef.current = true;
    try {
      const picked = await pickExportDir(root);
      if (picked === null) return; // cancelled
      if (picked.kind === "insideWorkspace") {
        // Exporting into the watched workspace would pollute it (and re-export
        // its own output next time).
        setSiteNotice({ kind: "insideWorkspace" });
        return;
      }
      setSiteNotice(null);
      setSiteProgress({ done: 0, total: 0 });
      // Heavy render pipeline loads only when the user actually exports.
      const { exportSite } = await import("@/lib/export/site/exportSite");
      const { pruneError } = await exportSite({
        root,
        outDir: picked.path,
        themes: pluginThemes,
        // Plugin markdown syntax renders in the export as it does in the viewer.
        remarkPlugins,
        rehypePlugins,
        onProgress: (done, total) => setSiteProgress({ done, total }),
      });
      if (pruneError !== null) setSiteNotice({ kind: "pruneFailed", reason: pruneError });
    } catch (err) {
      console.error("Failed to export website:", err);
      setSiteNotice({ kind: "failed", reason: errorMessage(err) });
    } finally {
      isExportingRef.current = false;
      setSiteProgress(null);
    }
  }, [root, pluginThemes, remarkPlugins, rehypePlugins]);

  const dismissSiteNotice = useCallback(() => setSiteNotice(null), []);

  return useMemo(
    () => ({ exportWebsite, siteProgress, siteNotice, dismissSiteNotice }),
    [exportWebsite, siteProgress, siteNotice, dismissSiteNotice],
  );
}
