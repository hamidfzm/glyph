import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { SidebarLayoutProvider, useSidebarLayoutContext } from "./SidebarLayoutContext";

// SidebarLayoutProvider reads settings from SettingsContext, which defaults to
// DEFAULT_SETTINGS when no SettingsProvider is mounted.
function wrap() {
  return ({ children }: { children: ReactNode }) => (
    <SidebarLayoutProvider>{children}</SidebarLayoutProvider>
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
