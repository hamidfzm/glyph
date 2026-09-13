import { useEffect, useState } from "react";
import { type ResolvedAssetRef, resolveAssetRef } from "@/components/markdown/resolveAssetRef";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { isDocumentAssetMirrored, mirrorDocumentAsset } from "@/lib/documentAssets";
import { clampRootFor } from "@/lib/relativePath";

/**
 * A markdown asset reference resolved for the webview. A workspace document's
 * folder is already in the asset scope; for a loose file (including one opened
 * into a workspace window) the backend checks each path and mirrors it in
 * first, so `src` stays undefined until it has answered.
 */
export function useAssetRef(
  src: string | undefined,
  filePath: string | undefined,
): ResolvedAssetRef {
  const workspaceRoot = useWorkspaceRoot();
  const root = clampRootFor(filePath, workspaceRoot);
  const resolved = resolveAssetRef(src, filePath, root);
  const loosePath = root ? undefined : resolved.path;
  const pendingPath = loosePath && !isDocumentAssetMirrored(loosePath) ? loosePath : undefined;
  // Keyed by path: an answer for a reference the element has since replaced
  // must not release the new one.
  const [answeredPath, setAnsweredPath] = useState<string>();

  useEffect(() => {
    if (!pendingPath) return;
    // A refused path still renders, and fails to load as it always has.
    mirrorDocumentAsset(pendingPath)
      .catch(() => undefined)
      .finally(() => setAnsweredPath(pendingPath));
  }, [pendingPath]);

  if (pendingPath && answeredPath !== pendingPath) return { ...resolved, src: undefined };
  return resolved;
}
