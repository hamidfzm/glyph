import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import type { WikilinkRef } from "@/lib/backlinks";
import type { MetadataEntry, MetadataScan } from "@/lib/metadata";
import {
  COMPLETE_INDEX_STATUS,
  COMPLETE_SCAN,
  type FileScan,
  indexIncompleteKey,
  sameScanStatus,
  truncatedScan,
  type WikilinkScan,
  type WorkspaceIndexStatus,
} from "@/lib/workspaceScan";

interface UseWorkspaceIndexOptions {
  /** Root of the currently open workspace, or null when none is open. */
  workspaceRoot: string | null;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

/**
 * The workspace's three indexes: the recursive markdown file list, outbound
 * wikilink refs, and per-file tags and frontmatter. All are ephemeral (rebuilt
 * on open and on directory changes) and each reports whether a configured cap
 * cut the scan short.
 */
export function useWorkspaceIndex({ workspaceRoot, onWorkspaceNotice }: UseWorkspaceIndexOptions) {
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [wikilinkRefs, setWikilinkRefs] = useState<WikilinkRef[]>([]);
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([]);
  const [indexStatus, setIndexStatus] = useState<WorkspaceIndexStatus>(COMPLETE_INDEX_STATUS);
  const onWorkspaceNoticeRef = useRef(onWorkspaceNotice);
  onWorkspaceNoticeRef.current = onWorkspaceNotice;

  const loadWorkspaceFiles = useCallback(async (root: string): Promise<FileScan> => {
    try {
      return await invoke<FileScan>("list_markdown_files", { path: root });
    } catch (err) {
      console.error(`Failed to list markdown files for ${root}:`, err);
      return { files: [], status: COMPLETE_SCAN };
    }
  }, []);

  const loadWikilinkRefs = useCallback(async (root: string): Promise<WikilinkScan> => {
    try {
      return await invoke<WikilinkScan>("scan_wikilinks", { path: root });
    } catch (err) {
      console.error(`Failed to scan wikilinks for ${root}:`, err);
      return { refs: [], status: COMPLETE_SCAN };
    }
  }, []);

  const loadMetadata = useCallback(async (root: string): Promise<MetadataScan> => {
    try {
      return await invoke<MetadataScan>("scan_metadata", { path: root });
    } catch (err) {
      console.error(`Failed to scan metadata for ${root}:`, err);
      return { files: [], status: COMPLETE_SCAN };
    }
  }, []);

  // Merge new scan statuses, keeping the previous object identity while the
  // values are unchanged so the incomplete-index banner effect below doesn't
  // refire on every directory refresh.
  const updateIndexStatus = useCallback((part: Partial<WorkspaceIndexStatus>) => {
    setIndexStatus((prev) => {
      const next = { ...prev, ...part };
      const unchanged =
        sameScanStatus(next.files, prev.files) &&
        sameScanStatus(next.wikilinks, prev.wikilinks) &&
        sameScanStatus(next.metadata, prev.metadata);
      return unchanged ? prev : next;
    });
  }, []);

  /**
   * Build every index for a freshly opened workspace. The file scan is awaited
   * (its result decides which note auto-opens); the wikilink and metadata scans
   * land later and are dropped when `isCurrent` reports the workspace was
   * replaced meanwhile.
   */
  const scanWorkspace = useCallback(
    async (root: string, isCurrent: () => boolean): Promise<string[]> => {
      const { files, status } = await loadWorkspaceFiles(root);
      setWorkspaceFiles(files);
      updateIndexStatus({ files: status });
      loadWikilinkRefs(root).then((scan) => {
        if (!isCurrent()) return;
        setWikilinkRefs(scan.refs);
        updateIndexStatus({ wikilinks: scan.status });
      });
      loadMetadata(root).then((scan) => {
        if (!isCurrent()) return;
        setMetadataEntries(scan.files);
        updateIndexStatus({ metadata: scan.status });
      });
      return files;
    },
    [loadMetadata, loadWikilinkRefs, loadWorkspaceFiles, updateIndexStatus],
  );

  /**
   * Rebuild every index after the workspace directory changed. The workspace
   * can be replaced while the scans run; the indexes are window-wide, so
   * writing this root's results into another root's workspace would leave the
   * sidebar and palette pointing at files that are no longer open.
   */
  const refreshIndexes = useCallback(
    async (root: string, isCurrent: () => boolean) => {
      const [files, refs, metadata] = await Promise.all([
        loadWorkspaceFiles(root),
        loadWikilinkRefs(root),
        loadMetadata(root),
      ]);
      if (!isCurrent()) return;
      setWorkspaceFiles(files.files);
      setWikilinkRefs(refs.refs);
      setMetadataEntries(metadata.files);
      updateIndexStatus({
        files: files.status,
        wikilinks: refs.status,
        metadata: metadata.status,
      });
    },
    [loadMetadata, loadWikilinkRefs, loadWorkspaceFiles, updateIndexStatus],
  );

  const clearIndexes = useCallback(() => {
    setWorkspaceFiles([]);
    setWikilinkRefs([]);
    setMetadataEntries([]);
    setIndexStatus(COMPLETE_INDEX_STATUS);
  }, []);

  /** Drop the outgoing workspace's scan state so an incoming one's truncation
   *  (even an identical one) notifies afresh. */
  const resetStatus = useCallback(() => setIndexStatus(COMPLETE_INDEX_STATUS), []);

  // Surface a persistent banner when a workspace index is incomplete (#436).
  // The user can dismiss it; the sidebar keeps its own indicator. Keyed on the
  // workspace root plus the effective reason + limit: a dismissed banner
  // re-shows only when the surfaced truncation actually changes (a rescan or
  // the second index reporting the same one refires nothing), while switching
  // workspaces notifies afresh even for an identical truncation.
  const truncation = truncatedScan(indexStatus);
  const truncationReason = truncation?.reason ?? null;
  const truncationLimit = truncation?.limit ?? null;
  useEffect(() => {
    if (!truncationReason || !workspaceRoot) return;
    onWorkspaceNoticeRef.current(
      {
        key: indexIncompleteKey(truncationReason),
        values: { limit: String(truncationLimit ?? 0) },
      },
      { persistent: true },
    );
  }, [workspaceRoot, truncationReason, truncationLimit]);

  return {
    workspaceFiles,
    wikilinkRefs,
    metadataEntries,
    indexStatus,
    scanWorkspace,
    refreshIndexes,
    clearIndexes,
    resetStatus,
  };
}
