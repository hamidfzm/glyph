import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { SyncConfigProvider } from "@/contexts/SyncConfigProvider";
import { TabsContext } from "@/contexts/TabsContext";
import { tabsContextValue } from "@/test/fixtures/tabsContext";

// Render sync UI with a folder workspace open. SyncConfigContext derives its
// workspace path from TabsContext and drives the (mocked) sync commands, so the
// real provider goes on top of an otherwise inert tabs context.
export function renderWithSync(ui: ReactNode, root: string | null = "/w") {
  const workspace = root ? { root, expanded: new Set<string>(), nodes: new Map() } : null;
  return render(
    <TabsContext.Provider value={tabsContextValue({ workspace })}>
      <SyncConfigProvider>{ui}</SyncConfigProvider>
    </TabsContext.Provider>,
  );
}
