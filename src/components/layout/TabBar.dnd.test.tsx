import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import type { TabsContextValue } from "@/contexts/TabsContext";
import type { FileTab, Tab } from "@/lib/tabs";
import { sidebarLayoutValue } from "@/test/fixtures/sidebarLayout";
import { TabsWrapper, tabsContextValue } from "@/test/fixtures/tabsContext";
import { dragFromTo, ghostEl, moveTo, releaseAt, setHit } from "@/test/pointerDrag";
import { TabBar } from "./TabBar";

const makeFileTab = (i: number): FileTab => ({
  id: `tab-${i}`,
  kind: "file",
  file: {
    path: `/path/to/file${i}.md`,
    content: `# File ${i}`,
    metadata: { name: `file${i}.md`, path: `/path/to/file${i}.md`, size: 100, modified: 0 },
    scrollTop: 0,
    mode: "view",
    editContent: null,
    dirty: false,
    virtual: false,
    revision: 0,
  },
});

const makeTabs = (count: number): Tab[] => Array.from({ length: count }, (_, i) => makeFileTab(i));

function renderTabBar(over: Partial<TabsContextValue> = {}) {
  return render(
    <TabsWrapper value={tabsContextValue({ tabs: makeTabs(2), activeTabId: "tab-0", ...over })}>
      <SidebarLayoutContext.Provider value={sidebarLayoutValue()}>
        <TabBar onToggleAIChat={null} onOpenPalette={vi.fn()} />
      </SidebarLayoutContext.Provider>
    </TabsWrapper>,
  );
}

describe("pointer drag reordering", () => {
  // Scoped to the strip: the drag ghost repeats the label in document.body.
  const strip = () => document.querySelector(".tab-bar-scroll") as HTMLElement;
  const labelEl = (name: string) => within(strip()).getByText(name);
  const tabEl = (name: string) => labelEl(name).closest(".tab-item") as HTMLElement;
  const activateButton = (name: string) => screen.getByRole("button", { name });

  const press = (name: string, init: Record<string, unknown> = {}) =>
    fireEvent.pointerDown(tabEl(name), { button: 0, clientX: 0, clientY: 0, ...init });

  beforeEach(() => {
    setHit(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("keeps a plain click activating the tab when movement stays below the threshold", () => {
    const setActiveTab = vi.fn();
    const moveTab = vi.fn();
    renderTabBar({ setActiveTab, moveTab });
    press("file1.md");
    moveTo(2, 2);
    expect(ghostEl()).toBeNull();
    releaseAt(2, 2);
    fireEvent.click(activateButton("file1.md"));
    expect(setActiveTab).toHaveBeenCalledWith("tab-1");
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("moves the dragged tab to the hovered tab's index on release", () => {
    const moveTab = vi.fn();
    renderTabBar({ tabs: makeTabs(3), moveTab });
    // Hit the label span inside the tab: descendants resolve to their tab.
    dragFromTo(tabEl("file0.md"), labelEl("file2.md"));
    releaseAt();
    expect(moveTab).toHaveBeenCalledWith("tab-0", 2);
    expect(tabEl("file2.md").hasAttribute("data-drop")).toBe(false);
    expect(ghostEl()).toBeNull();
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.dataset.pointerDrag).toBeUndefined();
  });

  it("commits the target the indicator showed, not where the pointer was released", () => {
    const moveTab = vi.fn();
    renderTabBar({ tabs: makeTabs(3), moveTab });
    dragFromTo(tabEl("file0.md"), tabEl("file2.md"));
    // The release lands a few px further, past the last tab.
    setHit(null);
    releaseAt(60, 40);
    expect(moveTab).toHaveBeenCalledWith("tab-0", 2);
  });

  it("captures the pointer on the pressed element, not on the wrapper carrying the handlers", () => {
    renderTabBar();
    const onLabel = vi.fn();
    const onWrapper = vi.fn();
    Object.assign(labelEl("file0.md"), { setPointerCapture: onLabel });
    Object.assign(tabEl("file0.md"), { setPointerCapture: onWrapper });
    fireEvent.pointerDown(labelEl("file0.md"), { button: 0, pointerId: 7 });
    // Capturing on the wrapper would retarget the click away from the inner
    // activate / close buttons.
    expect(onLabel).toHaveBeenCalledWith(7);
    expect(onWrapper).not.toHaveBeenCalled();
  });

  it("ignores another pointer's release or cancel mid-drag", () => {
    const moveTab = vi.fn();
    renderTabBar({ moveTab });
    dragFromTo(tabEl("file0.md"), tabEl("file1.md"));
    // A stray touch during a mouse drag.
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 9 });
    fireEvent.pointerCancel(window, { pointerId: 9 });
    expect(tabEl("file1.md").getAttribute("data-drop")).toBe("after");
    expect(moveTab).not.toHaveBeenCalled();
    releaseAt();
    expect(moveTab).toHaveBeenCalledWith("tab-0", 1);
  });

  it("ends the drag when a move arrives with the button already released", () => {
    const moveTab = vi.fn();
    renderTabBar({ moveTab });
    dragFromTo(tabEl("file0.md"), tabEl("file1.md"));
    // Focus stolen mid-press (Alt+Tab): the release never reached the page.
    fireEvent.pointerMove(window, { clientX: 45, clientY: 40, buttons: 0 });
    expect(ghostEl()).toBeNull();
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    releaseAt();
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("shows the trailing-edge indicator and the label ghost when dragging right", () => {
    renderTabBar({ tabs: makeTabs(3) });
    dragFromTo(tabEl("file0.md"), tabEl("file2.md"));
    // A second move over the same target keeps the same edge.
    moveTo(41, 40);
    expect(tabEl("file2.md").getAttribute("data-drop")).toBe("after");
    expect(ghostEl()?.textContent).toBe("file0.md");
    expect(document.body.style.cursor).toBe("grabbing");
    expect(document.body.dataset.pointerDrag).toBe("");
  });

  it("shows the leading-edge indicator when dragging left", () => {
    renderTabBar({ tabs: makeTabs(3), activeTabId: "tab-2" });
    dragFromTo(tabEl("file2.md"), tabEl("file0.md"));
    expect(tabEl("file0.md").getAttribute("data-drop")).toBe("before");
  });

  it("shows no indicator over the dragged tab itself and does not commit a self-drop", () => {
    const moveTab = vi.fn();
    renderTabBar({ moveTab });
    dragFromTo(tabEl("file0.md"), tabEl("file1.md"));
    expect(tabEl("file1.md").getAttribute("data-drop")).toBe("after");
    setHit(tabEl("file0.md"));
    moveTo(10, 10);
    expect(tabEl("file0.md").hasAttribute("data-drop")).toBe(false);
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    expect(document.body.style.cursor).toBe("no-drop");
    releaseAt(10, 10);
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("treats space outside the tab strip as no target", () => {
    const moveTab = vi.fn();
    renderTabBar({ moveTab });
    dragFromTo(tabEl("file0.md"), document.body);
    expect(document.body.style.cursor).toBe("no-drop");
    releaseAt();
    expect(moveTab).not.toHaveBeenCalled();
    // A hit-test miss (no element at the point at all) is equally inert.
    dragFromTo(tabEl("file0.md"), null);
    releaseAt();
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("cancels on Escape without reordering", () => {
    const moveTab = vi.fn();
    renderTabBar({ moveTab });
    dragFromTo(tabEl("file0.md"), tabEl("file1.md"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    expect(ghostEl()).toBeNull();
    releaseAt();
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("cancels when the browser cancels the pointer sequence", () => {
    const moveTab = vi.fn();
    renderTabBar({ moveTab });
    dragFromTo(tabEl("file0.md"), tabEl("file1.md"));
    fireEvent.pointerCancel(window);
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    expect(ghostEl()).toBeNull();
    expect(document.body.style.cursor).toBe("");
    releaseAt();
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("tears down the drag feedback when the strip unmounts mid-drag", () => {
    const { unmount } = renderTabBar();
    dragFromTo(tabEl("file0.md"), tabEl("file1.md"));
    expect(ghostEl()).not.toBeNull();
    unmount();
    expect(ghostEl()).toBeNull();
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.dataset.pointerDrag).toBeUndefined();
  });

  it("ignores stray pointer and key events while no drag is in progress", () => {
    const moveTab = vi.fn();
    renderTabBar({ moveTab });
    setHit(tabEl("file1.md"));
    moveTo(40, 40);
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("suppresses exactly one click after a completed drag", () => {
    const setActiveTab = vi.fn();
    renderTabBar({ setActiveTab });
    dragFromTo(tabEl("file0.md"), tabEl("file1.md"));
    releaseAt();
    fireEvent.click(activateButton("file0.md"));
    expect(setActiveTab).not.toHaveBeenCalled();
    fireEvent.click(activateButton("file0.md"));
    expect(setActiveTab).toHaveBeenCalledWith("tab-0");
  });

  it("leaves middle-click presses to the aux-click close instead of the drag", () => {
    const closeTab = vi.fn();
    const moveTab = vi.fn();
    renderTabBar({ closeTab, moveTab });
    press("file1.md", { button: 1 });
    setHit(tabEl("file0.md"));
    moveTo(40, 40);
    expect(ghostEl()).toBeNull();
    releaseAt();
    fireEvent(tabEl("file1.md"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(closeTab).toHaveBeenCalledWith("tab-1");
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("ignores touch presses (mobile has its own interaction model)", () => {
    renderTabBar();
    press("file0.md", { pointerType: "touch" });
    setHit(tabEl("file1.md"));
    moveTo(40, 40);
    expect(tabEl("file1.md").hasAttribute("data-drop")).toBe(false);
    expect(ghostEl()).toBeNull();
  });
});

// Regression: <button> cannot be a descendant of <button> per the HTML
// spec, and React 19 logs a hydration error when it sees it. The close
// button used to sit inside the tab activate button; now it's a sibling.
it("does not nest a button inside another button", () => {
  const { container } = renderTabBar();
  for (const button of container.querySelectorAll("button")) {
    expect(button.querySelector("button")).toBeNull();
  }
});
