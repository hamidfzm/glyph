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
 * Where every wikilink in `content` points, resolved by the index.
 *
 * The markdown pipeline is synchronous, so resolution cannot happen inside it
 * once the resolver lives in Rust. Instead every target in the document is
 * resolved in one call up front and the pipeline reads the answers.
 *
 * The answers are stamped with the document they were asked for. The previous
 * map stays in place while a new one loads for the same document, so editing
 * does not blink every link to broken between keystrokes; a different document
 * (a split pane switching tabs, an embed retargeted, the workspace closing)
 * gets nothing rather than the last document's paths, which would point a
 * click or an embed at the wrong note.
 */
export function useWikilinkResolutions(
  content: string | null | undefined,
  filePath: string | undefined,
): ReadonlyMap<string, string | null> {
  const root = useWorkspaceRoot();
  const snapshot = useVaultSnapshot();
  const [answered, setAnswered] = useState<Answered>(NOTHING);

  const targets = useMemo(() => (content ? wikilinkTargets(content) : []), [content]);
  // Typing prose between two links changes `content` but not the question, so
  // the ask is keyed on the targets rather than the document body.
  const targetKey = targets.join("\n");
  // Null-separated: no path segment can contain it, so two different pairs
  // cannot produce the same key.
  const key = `${root ?? ""}\u0000${filePath ?? ""}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `targetKey` stands in for `targets`, whose identity changes on every keystroke; `snapshot` is the re-ask trigger, since a created or renamed note changes where a link points
  useEffect(() => {
    if (!root || targets.length === 0) {
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
  }, [root, filePath, key, targetKey, snapshot]);

  return answered.key === key ? answered.map : NO_RESOLUTIONS;
}
