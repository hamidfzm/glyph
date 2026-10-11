import { render } from "@testing-library/react";
import { vi } from "vitest";
import { TabBar } from "@/components/layout/TabBar";
import { SidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import type { TabsContextValue } from "@/contexts/TabsContext";
import { sidebarLayoutValue } from "./fixtures/sidebarLayout";
import { TabsWrapper, tabsContextValue } from "./fixtures/tabsContext";

/** Render the tab strip over a tabs context holding `over` and inert defaults. */
export function renderTabStrip(over: Partial<TabsContextValue> = {}) {
  return render(
    <TabsWrapper value={tabsContextValue(over)}>
      <SidebarLayoutContext.Provider value={sidebarLayoutValue()}>
        <TabBar onToggleAIChat={null} onOpenPalette={vi.fn()} />
      </SidebarLayoutContext.Provider>
    </TabsWrapper>,
  );
}
