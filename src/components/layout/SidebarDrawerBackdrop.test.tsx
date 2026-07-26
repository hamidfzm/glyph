import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SidebarLayoutContext,
  type SidebarLayoutContextValue,
} from "@/contexts/SidebarLayoutContext";
import { SidebarDrawerBackdrop } from "./SidebarDrawerBackdrop";

function renderBackdrop(overrides: Partial<SidebarLayoutContextValue> = {}) {
  const value: SidebarLayoutContextValue = {
    filesVisible: false,
    outlineVisible: false,
    compact: true,
    closeCompactPanels: vi.fn(),
    toggleFiles: vi.fn(),
    toggleOutline: vi.fn(),
    resetLayout: vi.fn(),
    sidebarLayout: "split",
    swapSidebarSides: false,
    filesSidebarWidth: 200,
    outlineSidebarWidth: 260,
    backlinksHeight: null,
    setFilesSidebarWidth: vi.fn(),
    setOutlineSidebarWidth: vi.fn(),
    setBacklinksHeight: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <SidebarLayoutContext.Provider value={value}>
      <SidebarDrawerBackdrop />
    </SidebarLayoutContext.Provider>,
  );
  return { ...utils, value };
}

const backdrop = () => screen.queryByRole("button", { name: "Close" });

describe("SidebarDrawerBackdrop", () => {
  it("renders nothing when no drawer is open", () => {
    renderBackdrop();
    expect(backdrop()).not.toBeInTheDocument();
  });

  it("renders nothing on a desktop-width viewport, even with panels visible", () => {
    renderBackdrop({ compact: false, filesVisible: true, outlineVisible: true });
    expect(backdrop()).not.toBeInTheDocument();
  });

  it("covers the document while the files drawer is open", () => {
    renderBackdrop({ filesVisible: true });
    expect(backdrop()).toBeInTheDocument();
  });

  it("covers the document while the outline drawer is open", () => {
    renderBackdrop({ outlineVisible: true });
    expect(backdrop()).toBeInTheDocument();
  });

  it("dismisses the open drawer when tapped", () => {
    const closeCompactPanels = vi.fn();
    renderBackdrop({ outlineVisible: true, closeCompactPanels });
    fireEvent.click(backdrop()!);
    expect(closeCompactPanels).toHaveBeenCalled();
  });
});
