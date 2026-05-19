import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { SidebarLayoutProvider, useSidebarLayoutContext } from "./SidebarLayoutContext";

function wrap(settings: Settings = DEFAULT_SETTINGS) {
  return ({ children }: { children: ReactNode }) => (
    <SidebarLayoutProvider settings={settings} updateSettings={vi.fn()}>
      {children}
    </SidebarLayoutProvider>
  );
}

describe("SidebarLayoutProvider", () => {
  it("exposes visibility, layout, and width from settings", () => {
    const { result } = renderHook(() => useSidebarLayoutContext(), { wrapper: wrap() });
    expect(result.current.filesVisible).toBe(DEFAULT_SETTINGS.layout.filesSidebarVisible);
    expect(result.current.outlineVisible).toBe(DEFAULT_SETTINGS.layout.outlineSidebarVisible);
    expect(result.current.sidebarLayout).toBe(DEFAULT_SETTINGS.layout.sidebarLayout);
    expect(result.current.swapSidebarSides).toBe(DEFAULT_SETTINGS.layout.swapSidebarSides);
    expect(result.current.sidebarWidth).toBe(DEFAULT_SETTINGS.layout.sidebarWidth);
  });

  it("throws a clear error when the hook is used outside the provider", () => {
    expect(() => renderHook(() => useSidebarLayoutContext())).toThrow(/SidebarLayoutProvider/);
  });
});
