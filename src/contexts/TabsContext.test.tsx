import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { TabsProvider, useTabsContext } from "./TabsContext";

function wrap() {
  return ({ children }: { children: ReactNode }) => (
    <TabsProvider settings={DEFAULT_SETTINGS} updateSettings={vi.fn()}>
      {children}
    </TabsProvider>
  );
}

describe("TabsProvider", () => {
  it("exposes the useTabs API plus derived displayContent/toc/backlinks", async () => {
    const { result } = renderHook(() => useTabsContext(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTab).toBeNull();
    expect(result.current.displayContent).toBeNull();
    expect(result.current.tocEntries).toEqual([]);
    expect(result.current.backlinks).toEqual([]);
    expect(typeof result.current.openFile).toBe("function");
    expect(typeof result.current.openFolder).toBe("function");
  });

  it("throws a clear error when the hook is used outside the provider", () => {
    expect(() => renderHook(() => useTabsContext())).toThrow(/TabsProvider/);
  });
});
