import { vi } from "vitest";
import type { SidebarLayoutContextValue } from "@/contexts/SidebarLayoutContext";

/** The full SidebarLayoutContext surface as inert defaults, so a test only
 *  spells out the fields it asserts on. */
export function sidebarLayoutValue(
  overrides: Partial<SidebarLayoutContextValue> = {},
): SidebarLayoutContextValue {
  return {
    filesVisible: true,
    outlineVisible: true,
    compact: false,
    closeCompactPanels: vi.fn(),
    drawerDismissals: new Set(),
    toggleFiles: vi.fn(),
    toggleOutline: vi.fn(),
    resetLayout: vi.fn(),
    sidebarLayout: "split",
    swapSidebarSides: false,
    filesSidebarWidth: 200,
    outlineSidebarWidth: 260,
    backlinksHeight: null,
    tagsHeight: null,
    setFilesSidebarWidth: vi.fn(),
    setOutlineSidebarWidth: vi.fn(),
    setBacklinksHeight: vi.fn(),
    setTagsHeight: vi.fn(),
    ...overrides,
  };
}
