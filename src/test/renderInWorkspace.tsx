import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";

// Render with an opened workspace root in context, the value components read via
// useWorkspaceRoot. Provides a minimal TabsContext (only `workspace`); use in
// tests that exercise relative-path resolution and root clamping.
export function renderInWorkspace(ui: ReactNode, root = "/ws") {
  const tabs = { workspace: { root } } as unknown as TabsContextValue;
  return render(<TabsContext.Provider value={tabs}>{ui}</TabsContext.Provider>);
}
