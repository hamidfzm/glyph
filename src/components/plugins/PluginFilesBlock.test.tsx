import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import type { SidebarPanelEntry } from "@/lib/plugins/types";
import { DEFAULT_SETTINGS, type FilesBlockLayout } from "@/lib/settings";
import { PluginFilesBlock } from "./PluginFilesBlock";

const KEY = "com.x.links:links";

const panel: SidebarPanelEntry = {
  pluginId: "com.x.links",
  id: "links",
  title: "Links",
  location: "files",
  frame: { min: 80, naturalMax: 160 },
  mount: (el) => {
    el.textContent = "three links";
  },
};

function renderBlock(
  entry: SidebarPanelEntry = panel,
  blocks: Record<string, FilesBlockLayout> = {},
) {
  const value: SettingsContextValue = {
    settings: { ...DEFAULT_SETTINGS, layout: { ...DEFAULT_SETTINGS.layout, blocks } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const view = render(
    <SettingsContext.Provider value={value}>
      <PluginFilesBlock panel={entry} />
    </SettingsContext.Provider>,
  );
  return { ...view, updateSettings: value.updateSettings };
}

describe("PluginFilesBlock", () => {
  it("draws the heading and lets the plugin fill the body", () => {
    renderBlock();
    expect(screen.getByRole("button", { name: "Links" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("three links")).toBeVisible();
  });

  it("lets the plugin fill the rest of the heading", () => {
    renderBlock({
      ...panel,
      mountHeading: (el) => {
        el.textContent = "3";
      },
    });
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("leaves the heading to its title when the plugin adds nothing to it", () => {
    const { container } = renderBlock();
    expect(container.querySelector('[data-plugin-slot="links:heading"]')).toBeNull();
  });

  it("persists the collapsed state instead of holding it locally", () => {
    const { updateSettings } = renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Links" }));
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("layout.blocks", {
      [KEY]: { height: null, collapsed: true },
    });
  });

  it("keeps the other blocks' layout when it saves its own", () => {
    const other = { height: 120, collapsed: false };
    const { updateSettings } = renderBlock(panel, { "com.x.other:notes": other });
    fireEvent.click(screen.getByRole("button", { name: "Links" }));
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("layout.blocks", {
      "com.x.other:notes": other,
      [KEY]: { height: null, collapsed: true },
    });
  });

  // Hidden, not unmounted, so the plugin keeps its state; marked so plugin CSS
  // can hide heading controls that act on the body.
  it("hides the body and marks the block while collapsed", () => {
    const { container } = renderBlock(panel, { [KEY]: { height: null, collapsed: true } });
    expect(screen.getByRole("button", { name: "Links" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("three links")).not.toBeVisible();
    expect(container.querySelector("section")).toHaveAttribute("data-collapsed");
  });

  it("expands again from the heading, keeping the saved height", () => {
    const { updateSettings } = renderBlock(panel, { [KEY]: { height: 140, collapsed: true } });
    fireEvent.click(screen.getByRole("button", { name: "Links" }));
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("layout.blocks", {
      [KEY]: { height: 140, collapsed: false },
    });
  });

  // Nothing left to resize once the block is just its heading.
  it("drops the divider while the block is collapsed", () => {
    renderBlock(panel, { [KEY]: { height: null, collapsed: true } });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("names the divider after the block and bounds it by the plugin's minimum", () => {
    renderBlock();
    const handle = screen.getByRole("separator", { name: "Resize Links" });
    expect(handle).toHaveAttribute("aria-valuemin", "80");
  });

  it("falls back to a default minimum when the plugin sets no frame", () => {
    renderBlock({ ...panel, frame: undefined });
    expect(screen.getByRole("separator", { name: "Resize Links" })).toHaveAttribute(
      "aria-valuemin",
      "56",
    );
  });

  it("applies a persisted height when idle", () => {
    renderBlock(panel, { [KEY]: { height: 150, collapsed: false } });
    const handle = screen.getByRole("separator", { name: "Resize Links" });
    expect((handle.nextElementSibling as HTMLElement).style.height).toBe("150px");
    expect(handle).toHaveAttribute("aria-valuenow", "150");
  });

  it("caps the natural height until the user drags the divider", () => {
    renderBlock();
    const block = screen.getByRole("separator").nextElementSibling as HTMLElement;
    expect(block.style.maxHeight).toBe("160px");
    expect(block.style.height).toBe("");
  });

  it("drags the divider and persists the height", () => {
    const { updateSettings } = renderBlock();
    const handle = screen.getByRole("separator", { name: "Resize Links" });
    const block = handle.nextElementSibling as HTMLElement;
    Object.defineProperty(block, "offsetHeight", { configurable: true, value: 100 });
    Object.defineProperty(block.parentElement as HTMLElement, "clientHeight", {
      configurable: true,
      value: 500,
    });
    fireEvent.pointerDown(handle, { button: 0, clientY: 400 });
    // The block sits below the tree: dragging the divider up grows it.
    fireEvent.pointerMove(handle, { clientY: 360 });
    expect(block.style.height).toBe("140px");
    fireEvent.pointerUp(handle);
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("layout.blocks", {
      [KEY]: { height: 140, collapsed: false },
    });
  });

  it("double-click on the divider restores the automatic height", () => {
    const { updateSettings } = renderBlock(panel, { [KEY]: { height: 150, collapsed: false } });
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize Links" }));
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("layout.blocks", {
      [KEY]: { height: null, collapsed: false },
    });
  });

  // settings.json is hand-editable.
  it("treats a malformed saved layout as the default", () => {
    const malformed = { height: "tall", collapsed: "yes" } as unknown as FilesBlockLayout;
    renderBlock(panel, { [KEY]: malformed });
    expect(screen.getByRole("button", { name: "Links" })).toHaveAttribute("aria-expanded", "true");
    const block = screen.getByRole("separator").nextElementSibling as HTMLElement;
    expect(block.style.height).toBe("");
  });
});
