import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollToHeading } from "@/lib/scrollToHeading";
import { EDITOR_MODE } from "@/lib/settings";
import { type FileTab, type GraphTab, makeFileState, type Tab } from "@/lib/tabs";
import { useNavigationHistory } from "./useNavigationHistory";

const fileTab = (id: string, path: string): FileTab => ({
  id,
  kind: "file",
  file: makeFileState(path, EDITOR_MODE.view),
});
const tabA = fileTab("a", "/notes/a.md");
const tabB = fileTab("b", "/notes/b.md");
const tabC = fileTab("c", "/notes/c.md");
const graphTab: GraphTab = { id: "g", kind: "graph", root: "/notes", file: null };

function setup(activeTab: Tab | null, initializing = false) {
  const openFile = vi.fn(() => Promise.resolve());
  const openGraph = vi.fn();
  const scrolls = new Map<string, number>();
  const getScrollPosition = (id: string) => scrolls.get(id) ?? 0;
  const hook = renderHook(
    (props: { activeTab: Tab | null; initializing: boolean }) =>
      useNavigationHistory({ ...props, openFile, openGraph, getScrollPosition }),
    { initialProps: { activeTab, initializing } },
  );
  const activate = (tab: Tab | null, stillInitializing = false) =>
    hook.rerender({ activeTab: tab, initializing: stillInitializing });
  const back = () => act(() => hook.result.current.navigateBack());
  const forward = () => act(() => hook.result.current.navigateForward());
  return { openFile, openGraph, scrolls, activate, back, forward };
}

// A rendered document: the scroller the viewer marks plus one heading in it.
function mountDocument() {
  const scroller = document.createElement("div");
  scroller.setAttribute("data-scroll-container", "");
  const heading = document.createElement("h2");
  heading.id = "intro";
  scroller.appendChild(heading);
  document.body.appendChild(scroller);
  const scrollIntoView = vi.spyOn(heading, "scrollIntoView").mockImplementation(() => {});
  return { scroller, scrollIntoView };
}

describe("useNavigationHistory", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("goes back to the previously active tab and forward again", () => {
    const h = setup(tabA);
    h.activate(tabB);

    h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md");
    h.activate(tabA);

    h.forward();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/b.md");
    expect(h.openFile).toHaveBeenCalledTimes(2);
  });

  it("does nothing at either end of the history", () => {
    const h = setup(tabA);
    h.back();
    h.forward();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(h.openGraph).not.toHaveBeenCalled();
  });

  it("ignores the activations made while the session is restoring", () => {
    const h = setup(tabA, true);
    h.activate(tabB, true);
    h.activate(tabB);
    h.back();
    expect(h.openFile).not.toHaveBeenCalled();

    h.activate(tabC);
    h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/b.md");
  });

  it("drops the forward entries when navigating somewhere new after Back", () => {
    const h = setup(tabA);
    h.activate(tabB);
    h.back();
    h.activate(tabA);
    h.activate(tabC);

    h.forward();
    expect(h.openFile).toHaveBeenCalledTimes(1);
    h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md");
  });

  it("reopens a file whose tab has been closed", () => {
    const h = setup(tabA);
    h.activate(tabB);
    h.activate(null);

    h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md");
  });

  it("returns to the graph through openGraph", () => {
    const h = setup(tabA);
    h.activate(graphTab);
    h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md");
    h.activate(tabA);

    h.forward();
    expect(h.openGraph).toHaveBeenCalledOnce();
  });

  it("records a heading jump and Back restores the pre-jump scroll position", () => {
    const { scroller, scrollIntoView } = mountDocument();
    const h = setup(tabA);
    h.scrolls.set("a", 320);
    act(() => {
      scrollToHeading("intro");
    });

    h.back();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(320);

    h.forward();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not record scrolling by hand", () => {
    const { scroller } = mountDocument();
    const h = setup(tabA);
    act(() => {
      scroller.scrollTop = 900;
      scroller.dispatchEvent(new Event("scroll"));
    });

    h.back();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
  });

  it("keeps the heading entry when coming back from another tab", () => {
    const { scroller } = mountDocument();
    const h = setup(tabA);
    h.scrolls.set("a", 320);
    act(() => {
      scrollToHeading("intro");
    });
    h.activate(tabB);

    h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md");
    h.activate(tabA);
    h.back();
    expect(h.openFile).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(320);
  });

  it("never records an unsaved buffer, which has no file to reopen", () => {
    const untitled: Tab = {
      id: "u",
      kind: "file",
      file: { ...makeFileState("Untitled-1", EDITOR_MODE.edit), virtual: true },
    };
    const h = setup(tabA);
    h.activate(untitled);
    h.activate(tabB);

    h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md");
  });

  it("ignores heading jumps with no tab or an unsaved buffer active", () => {
    mountDocument();
    const untitled: Tab = {
      id: "u",
      kind: "file",
      file: { ...makeFileState("Untitled-1", EDITOR_MODE.edit), virtual: true },
    };
    const h = setup(null);
    act(() => {
      scrollToHeading("intro");
    });
    h.activate(untitled);
    act(() => {
      scrollToHeading("intro");
    });
    h.back();
    expect(h.openFile).not.toHaveBeenCalled();
  });

  it("ignores heading jumps while the graph is active", () => {
    mountDocument();
    const h = setup(graphTab);
    act(() => {
      scrollToHeading("intro");
    });
    h.back();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(h.openGraph).not.toHaveBeenCalled();
  });
});
