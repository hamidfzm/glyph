import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useExportReadiness } from "@/hooks/useExportReadiness";
import { getCliServeRequest } from "@/lib/cliServe";

/** Rust emits this whenever the watched folder changed, already debounced. */
export const SERVE_CHANGED_EVENT = "serve://changed";

// Once-per-process latch, for the same reason as the CLI export runner: the
// effect may fire more than once, but only one serve loop may exist.
let started = false;

/** Test-only: allow each test to run the effect fresh. */
export function resetCliServeRunner(): void {
  started = false;
}

/**
 * Runs the render half of `glyph serve`.
 *
 * The site pipeline only exists in the renderer, so the process splits in
 * two: Rust owns the socket and the file watch, this hook owns the export.
 * It renders once on mount, then again on every change Rust reports, telling
 * Rust after each build so the open browsers reload.
 *
 * A failed build is reported and otherwise ignored: whatever was exported
 * last is still on disk and still being served, so the browser keeps showing
 * a site rather than nothing. That site is not guaranteed to be the previous
 * one in full, because the export writes pages in place as it goes, so a
 * failure part way through leaves a mixture (see #707). On every launch that
 * is not `glyph serve` this is a no-op.
 */
export function useCliServe(): void {
  const { ready, themes, remarkPlugins, rehypePlugins } = useExportReadiness();

  // Held in refs so a plugin registering late is picked up by the next
  // rebuild without tearing down and re-registering the change listener.
  const contributions = useRef({ themes, remarkPlugins, rehypePlugins });
  contributions.current = { themes, remarkPlugins, rehypePlugins };

  useEffect(() => {
    if (!ready) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    // A change that lands mid-build queues exactly one more build: the
    // export reads the whole folder, so one more pass covers any number of
    // edits that arrived while it was running.
    let building = false;
    let queued = false;

    const build = async (root: string, outDir: string) => {
      if (building) {
        queued = true;
        return;
      }
      building = true;
      try {
        do {
          queued = false;
          // Checked before each pass, not only after the export: a change
          // queued while the last one was reporting would otherwise render a
          // whole site for a process that has already gone.
          if (disposed) return;
          let built = false;
          try {
            const { exportSite } = await import("@/lib/export/site/exportSite");
            await exportSite({
              root,
              outDir,
              themes: contributions.current.themes,
              remarkPlugins: contributions.current.remarkPlugins,
              rehypePlugins: contributions.current.rehypePlugins,
            });
            built = true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (disposed) return;
            await invoke("serve_failed", { message: `Rebuild failed: ${message}` });
          }
          // Reporting lives outside the try so that an IPC failure is not
          // announced as a failed build: the site did render.
          if (built && !disposed) await invoke("serve_ready");
        } while (queued);
      } finally {
        building = false;
      }
    };

    void (async () => {
      const request = await getCliServeRequest();
      if (!request || disposed || started) return;
      started = true;

      unlisten = await listen(SERVE_CHANGED_EVENT, () => {
        // A rejection here would escape as an unhandled one and be reported
        // as a crash; a rebuild that cannot even report its own failure is
        // not worth ending the serve loop over.
        void build(request.root, request.outDir).catch(() => {});
      });
      if (disposed) {
        unlisten();
        return;
      }
      await build(request.root, request.outDir);
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ready]);
}
