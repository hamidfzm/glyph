import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { wikilinkTargets } from "@/lib/wikilinkNodes";

const NONE: ReadonlyMap<string, string | null> = new Map();

/**
 * Where every wikilink in `content` points, resolved by the index.
 *
 * The markdown pipeline is synchronous, so resolution cannot happen inside it
 * once the resolver lives in Rust. Instead every target in the document is
 * resolved in one call up front and the pipeline reads the answers.
 *
 * The previous map stays in place while a new one loads, so editing a document
 * does not blink every link to broken between keystrokes; only targets typed
 * since the last answer render broken, and only until it arrives.
 */
export function useWikilinkResolutions(
  content: string | null | undefined,
  filePath: string | undefined,
): ReadonlyMap<string, string | null> {
  const root = useWorkspaceRoot();
  const [resolutions, setResolutions] = useState(NONE);

  useEffect(() => {
    if (!root || !content) return;
    const targets = wikilinkTargets(content);
    if (targets.length === 0) {
      setResolutions(NONE);
      return;
    }

    let current = true;
    invoke<(string | null)[]>("vault_resolve", { root, from: filePath ?? null, targets })
      .then((paths) => {
        if (!current) return;
        setResolutions(new Map(targets.map((target, i) => [target, paths[i] ?? null])));
      })
      .catch((err) => {
        console.error(`Failed to resolve wikilinks in ${filePath ?? "the document"}:`, err);
      });
    return () => {
      current = false;
    };
  }, [root, content, filePath]);

  return resolutions;
}
