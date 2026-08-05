import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeWorkspace, renderSidebar } from "@/test/fixtures/sidebar";

vi.mock("@/lib/pickers", () => ({
  pickMoveDir: vi.fn(),
}));

describe("Sidebar as a compact drawer", () => {
  it("overlays the document instead of taking a column", () => {
    const { container } = renderSidebar({ compact: true });
    const panel = container.querySelector("[data-sidebar]");
    expect(panel?.className).toContain("absolute");
  });

  it("sits in the layout flow on a desktop-width viewport", () => {
    const { container } = renderSidebar({ compact: false });
    const panel = container.querySelector("[data-sidebar]");
    expect(panel?.className).toContain("relative");
    expect(panel?.className).not.toContain("absolute");
  });

  // The drawer anchors to the edge it belongs to, so a swapped layout slides in
  // from the right instead of the left.
  it("anchors to the side it is rendered on", () => {
    const left = renderSidebar({ compact: true });
    expect(left.container.querySelector("[data-sidebar]")?.className).toContain("start-0");
    left.unmount();

    const right = renderSidebar({ compact: true, swapSidebarSides: true, side: "right" });
    expect(right.container.querySelector("[data-sidebar]")?.className).toContain("end-0");
  });

  // Opening a file has to dismiss the drawer, or the freshly opened document
  // stays hidden behind it.
  it("closes itself when a file is opened from the tree", () => {
    const openFile = vi.fn();
    const closeCompactPanels = vi.fn();
    renderSidebar({
      workspace: makeWorkspace(),
      compact: true,
      closeCompactPanels,
      tabs: { openFile },
    });

    fireEvent.click(screen.getByText("readme.md"));
    expect(openFile).toHaveBeenCalled();
    expect(closeCompactPanels).toHaveBeenCalled();
  });

  it("stays open when a file is opened on a desktop-width viewport", () => {
    const openFile = vi.fn();
    const closeCompactPanels = vi.fn();
    renderSidebar({
      workspace: makeWorkspace(),
      compact: false,
      closeCompactPanels,
      tabs: { openFile },
    });

    fireEvent.click(screen.getByText("readme.md"));
    expect(openFile).toHaveBeenCalled();
    expect(closeCompactPanels).not.toHaveBeenCalled();
  });
});
