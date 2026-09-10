import { useEffect, useMemo, useState } from "react";
import { useVaultSnapshot, useWorkspaceRoot } from "@/contexts/TabsContext";
import { wikilinkTargets } from "@/lib/wikilinkNodes";
import { NO_RESOLUTIONS, resolvePaths } from "@/lib/wikilinkResolutions";

interface Answered {
  /** The document the answers belong to. */
  key: string;
  map: ReadonlyMap<string, string | null>;
}

const NOTHING: Answered = { key: "", map: NO_RESOLUTIONS };

/**
 * Where every wikilink in `content` points. The markdown pipeline is
 * synchronous, so the whole document is resolved in one call up front and the
 * pipeline reads the answers.
 *
 * Answers are stamped with the document they belong to: a split pane is not
 * keyed by tab, so without the stamp the next document's first render would
 * use the previous one's paths and a click could open the wrong note.
 */
export function useWikilinkResolutions(
  content: string | null | undefined,
  filePath: string | undefined,
  enabled = true,
): { resolutions: ReadonlyMap<string, string | null>; pending: boolean } {
  const root = useWorkspaceRoot();
  const snapshot = useVaultSnapshot();
  const [answered, setAnswered] = useState<Answered>(NOTHING);

  // Typing prose between two links changes `content` but not the question, so
  // the ask is keyed on the targets rather than the document body. A target
  // cannot contain a newline (the pattern stops at one), so the joined form
  // is a faithful key to rebuild the list from.
  const targetKey = useMemo(
    () => (content && enabled ? wikilinkTargets(content).join("\n") : ""),
    [content, enabled],
  );
  const targets = useMemo(() => (targetKey ? targetKey.split("\n") : []), [targetKey]);
  // Null-separated: no path segment can contain it, so two different pairs
  // cannot produce the same key.
  const key = `${root ?? ""}\u0000${filePath ?? ""}`;

  useEffect(() => {
    // Nothing is indexed, so nothing resolves.
    if (!root || targets.length === 0 || snapshot.files.length === 0) {
      setAnswered((prev) =>
        prev.key === key && prev.map === NO_RESOLUTIONS ? prev : { key, map: NO_RESOLUTIONS },
      );
      return;
    }
    let current = true;
    resolvePaths(root, filePath, targets)
      .then((map) => {
        if (current) setAnswered({ key, map });
      })
      .catch((err) => {
        console.error(`Failed to resolve wikilinks in ${filePath ?? "the document"}:`, err);
        if (current) setAnswered({ key, map: NO_RESOLUTIONS });
      });
    return () => {
      current = false;
    };
  }, [root, filePath, key, targets, snapshot]);

  const answeredHere = answered.key === key;
  return {
    resolutions: answeredHere ? answered.map : NO_RESOLUTIONS,
    // Nothing to wait for outside a workspace, or in a document with no links:
    // those render broken (or render nothing) immediately, as before.
    pending: !answeredHere && !!root && targets.length > 0,
  };
}
