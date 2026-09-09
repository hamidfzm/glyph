import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { EMPTY_SNAPSHOT } from "@/lib/vault";

// Render with an opened workspace root in context, the value components read via
// useWorkspaceRoot. Provides a minimal TabsContext (`workspace` plus the index
// snapshot); use in tests that exercise relative-path resolution, root
// clamping, and wikilink resolution.

/** Enough of an index to count as one: the hooks skip an empty index rather
 *  than ask it questions it cannot answer. */
const INDEXED = [`/ws/indexed.md`];

export function renderInWorkspace(ui: ReactNode, root = "/ws", files: string[] = INDEXED) {
  const tabs = {
    workspace: { root },
    snapshot: { ...EMPTY_SNAPSHOT, files },
  } as unknown as TabsContextValue;
  return render(<TabsContext.Provider value={tabs}>{ui}</TabsContext.Provider>);
}
