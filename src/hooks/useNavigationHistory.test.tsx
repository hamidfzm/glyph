import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollToHeading } from "@/lib/scrollToHeading";
import { EDITOR_MODE } from "@/lib/settings";
import { type FileTab, type GraphTab, makeFileState, type Tab } from "@/lib/tabs";
import { deferred } from "@/test/deferred";
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
const untitled: Tab = {
  id: "u",
  kind: "file",
  file: { ...makeFileState("Untitled-1", EDITOR_MODE.edit), virtual: true },
};

interface Props {
  activeTab: Tab | null;
  initializing?: boolean;
  workspaceRoot?: string | null;
}

function setup(activeTab: Tab | null, initial: Omit<Props, "activeTab"> = {}) {
  const openFile = vi.fn(() => Promise.resolve(true));
  const openGraph = vi.fn();
  const scrolls = new Map<string, number>();
  const getScrollPosition = (id: string) => scrolls.get(id) ?? 0;
  const hook = renderHook(
    ({ activeTab, initializing = false, workspaceRoot = "/notes" }: Props) =>
      useNavigationHistory({
        activeTab,
        initializing,
        workspaceRoot,
        openFile,
        openGraph,
        getScrollPosition,
      }),
    { initialProps: { activeTab, ...initial } },
  );
  const activate = (tab: Tab | null, rest: Omit<Props, "activeTab"> = {}) =>
    hook.rerender({ activeTab: tab, ...rest });
  // Moves that reopen a file finish on a microtask; flush it before asserting.
  const back = () =>
    act(async () => {
      hook.result.current.navigateBack();
    });
  const forward = () =>
    act(async () => {
      hook.result.current.navigateForward();
    });
  return { hook, openFile, openGraph, scrolls, activate, back, forward };
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

  it("goes back to the previously active tab and forward again", async () => {
    const h = setup(tabA);
    h.activate(tabB);

    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
    h.activate(tabA);

    await h.forward();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/b.md", { implicit: true });
    expect(h.openFile).toHaveBeenCalledTimes(2);
  });

  it("does nothing at either end of the history", async () => {
    const h = setup(tabA);
    await h.back();
    await h.forward();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(h.openGraph).not.toHaveBeenCalled();
  });

  it("ignores the activations made while the session is restoring", async () => {
    const h = setup(tabA, { initializing: true });
    h.activate(tabB, { initializing: true });
    h.activate(tabB);
    await h.back();
    expect(h.openFile).not.toHaveBeenCalled();

    h.activate(tabC);
    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/b.md", { implicit: true });
  });

  it("drops the forward entries when navigating somewhere new after Back", async () => {
    const h = setup(tabA);
    h.activate(tabB);
    await h.back();
    h.activate(tabA);
    h.activate(tabC);

    await h.forward();
    expect(h.openFile).toHaveBeenCalledTimes(1);
    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
  });

  it("reopens a file whose tab has been closed", async () => {
    const h = setup(tabA);
    h.activate(tabB);
    h.activate(null);

    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
  });

  it("rewinds when the entry's file now lives in another window", async () => {
    // The move never landed here, so leaving the index on it would make the
    // next Back skip the entry the user is actually standing on.
    const h = setup(tabA);
    h.activate(tabB);
    h.activate(tabC);
    h.openFile.mockImplementationOnce(async () => false);

    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/b.md", { implicit: true });

    // Back again targets b, not a: the rewound index did not advance past it.
    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/b.md", { implicit: true });
  });

  it("waits for a reopen to land before taking the next move", async () => {
    const h = setup(tabA);
    h.activate(tabB);
    h.activate(tabC);
    const pending = deferred<boolean>();
    h.openFile.mockImplementationOnce(() => pending.promise);

    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/b.md", { implicit: true });
    await h.back();
    await h.forward();
    expect(h.openFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(true);
    });
    h.activate(tabB);
    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
  });

  it("returns to the graph of its own workspace", async () => {
    const h = setup(tabA);
    h.activate(graphTab);
    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
    h.activate(tabA);

    await h.forward();
    expect(h.openGraph).toHaveBeenCalledWith("/notes");
  });

  it("starts over when the workspace changes", async () => {
    const h = setup(tabA);
    h.activate(tabB);
    h.activate(tabA, { workspaceRoot: "/elsewhere" });

    await h.back();
    expect(h.openFile).not.toHaveBeenCalled();
  });

  it("follows a rename instead of treating the new path as a new place", async () => {
    const h = setup(tabA);
    h.activate(tabB);
    act(() => {
      h.hook.result.current.repointHistory("/notes/b.md", "/notes/renamed.md");
    });
    h.activate(fileTab("b", "/notes/renamed.md"));

    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
    h.activate(tabA);
    await h.forward();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/renamed.md", { implicit: true });
    expect(h.openFile).toHaveBeenCalledTimes(2);
  });

  it("records a heading jump and Back restores the pre-jump scroll position", async () => {
    const { scroller, scrollIntoView } = mountDocument();
    const h = setup(tabA);
    h.scrolls.set("a", 320);
    act(() => {
      scrollToHeading("intro");
    });

    await h.back();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(320);

    await h.forward();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not record scrolling by hand", async () => {
    const { scroller } = mountDocument();
    const h = setup(tabA);
    act(() => {
      scroller.scrollTop = 900;
      scroller.dispatchEvent(new Event("scroll"));
    });

    await h.back();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(900);
  });

  it("keeps the heading entry when coming back from another tab", async () => {
    const { scroller } = mountDocument();
    const h = setup(tabA);
    h.scrolls.set("a", 320);
    act(() => {
      scrollToHeading("intro");
    });
    h.activate(tabB);

    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
    h.activate(tabA);
    await h.back();
    expect(h.openFile).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(320);
  });

  it("never records an unsaved buffer, which has no file to reopen", async () => {
    const h = setup(tabA);
    h.activate(untitled);
    h.activate(tabB);

    await h.back();
    expect(h.openFile).toHaveBeenLastCalledWith("/notes/a.md", { implicit: true });
  });

  it("ignores heading jumps with no tab or an unsaved buffer active", async () => {
    mountDocument();
    const h = setup(null);
    act(() => {
      scrollToHeading("intro");
    });
    h.activate(untitled);
    act(() => {
      scrollToHeading("intro");
    });
    await h.back();
    expect(h.openFile).not.toHaveBeenCalled();
  });

  it("ignores heading jumps while the graph is active", async () => {
    mountDocument();
    const h = setup(graphTab);
    act(() => {
      scrollToHeading("intro");
    });
    await h.back();
    expect(h.openFile).not.toHaveBeenCalled();
    expect(h.openGraph).not.toHaveBeenCalled();
  });
});
