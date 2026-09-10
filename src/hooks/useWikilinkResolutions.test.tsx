import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { EMPTY_SNAPSHOT, type VaultSnapshot } from "@/lib/vault";
import { parkInvoke } from "@/test/parkInvoke";
import { useWikilinkResolutions } from "./useWikilinkResolutions";

// Mutable so a test can move the workspace or the index under the hook the way
// the provider does, then rerender.
/** An index holding notes; an empty one resolves nothing. */
const indexed: VaultSnapshot = { ...EMPTY_SNAPSHOT, files: ["/ws/One.md"] };

const context: { root: string | null; snapshot: VaultSnapshot } = {
  root: "/ws",
  snapshot: indexed,
};

function Wrapper({ children }: { children: ReactNode }) {
  const value = {
    workspace: context.root ? { root: context.root } : null,
    snapshot: context.snapshot,
  } as unknown as TabsContextValue;
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

/** The index's answer: every target resolves inside the linking file's folder. */
function resolveInOwnFolder() {
  vi.mocked(invoke).mockImplementation(((
    _cmd: string,
    args: { from?: string; targets: string[] },
  ) =>
    Promise.resolve(
      args.targets.map((t) => `${args.from?.replace(/\/[^/]+$/, "") ?? "/ws"}/${t}.md`),
    )) as unknown as typeof invoke);
}

beforeEach(() => {
  context.root = "/ws";
  context.snapshot = indexed;
  vi.mocked(invoke).mockReset();
});

describe("useWikilinkResolutions", () => {
  it("resolves every target in the document in one call", async () => {
    resolveInOwnFolder();
    const { result } = renderHook(
      () => useWikilinkResolutions("[[One]] and [[Two]] and [[One]]", "/ws/a/Doc.md"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.resolutions.size).toBe(2));
    expect(result.current.resolutions.get("One")).toBe("/ws/a/One.md");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("vault_resolve", {
      root: "/ws",
      from: "/ws/a/Doc.md",
      targets: ["One", "Two"],
    });
  });

  it("asks nothing for a document with no wikilinks", () => {
    const { result } = renderHook(() => useWikilinkResolutions("plain prose", "/ws/Doc.md"), {
      wrapper: Wrapper,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  // Rendering every link broken until the index answers reads as breakage, not
  // as loading, so the first frame says "pending" instead.
  it("reports pending until the first answer lands", async () => {
    resolveInOwnFolder();
    const { result } = renderHook(() => useWikilinkResolutions("[[One]]", "/ws/Doc.md"), {
      wrapper: Wrapper,
    });
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.resolutions.get("One")).toBe("/ws/One.md");
  });

  it("is not pending outside a workspace, where links are simply broken", () => {
    context.root = null;
    const { result } = renderHook(() => useWikilinkResolutions("[[One]]", "/loose/Doc.md"), {
      wrapper: Wrapper,
    });
    expect(result.current.pending).toBe(false);
  });

  it("resolves nothing outside a workspace", () => {
    context.root = null;
    const { result } = renderHook(() => useWikilinkResolutions("[[One]]", "/loose/Doc.md"), {
      wrapper: Wrapper,
    });
    expect(result.current.resolutions.size).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  // A pane that renders two documents in turn (a split view switching tabs, an
  // embed retargeted) must never show the first document's paths under the
  // second, which would open or embed the wrong note.
  it("drops the previous document's answers the moment the file changes", async () => {
    resolveInOwnFolder();
    const { result, rerender } = renderHook(
      ({ path }) => useWikilinkResolutions("[[Shared]]", path),
      { wrapper: Wrapper, initialProps: { path: "/ws/a/One.md" } },
    );
    await waitFor(() => expect(result.current.resolutions.get("Shared")).toBe("/ws/a/Shared.md"));

    rerender({ path: "/ws/b/Two.md" });
    expect(result.current.resolutions.size).toBe(0);
    await waitFor(() => expect(result.current.resolutions.get("Shared")).toBe("/ws/b/Shared.md"));
  });

  it("resolves nothing once the workspace closes under an open document", async () => {
    resolveInOwnFolder();
    const { result, rerender } = renderHook(() => useWikilinkResolutions("[[One]]", "/ws/Doc.md"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.resolutions.get("One")).toBe("/ws/One.md"));

    context.root = null;
    rerender();
    expect(result.current.resolutions.size).toBe(0);
  });

  // Editing prose keeps the links resolved, so they don't blink to broken
  // between keystrokes.
  it("keeps the answers while the same document's targets are unchanged", async () => {
    resolveInOwnFolder();
    const { result, rerender } = renderHook(
      ({ content }) => useWikilinkResolutions(content, "/ws/Doc.md"),
      { wrapper: Wrapper, initialProps: { content: "[[One]]" } },
    );
    await waitFor(() => expect(result.current.resolutions.get("One")).toBe("/ws/One.md"));

    rerender({ content: "typing [[One]] more" });
    expect(result.current.resolutions.get("One")).toBe("/ws/One.md");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("re-asks when the index changes, so a created target stops reading broken", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([null]).mockResolvedValueOnce(["/ws/One.md"]);
    const { result, rerender } = renderHook(() => useWikilinkResolutions("[[One]]", "/ws/Doc.md"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.resolutions.get("One")).toBeNull());

    context.snapshot = { ...indexed, files: ["/ws/One.md", "/ws/Two.md"] };
    rerender();
    await waitFor(() => expect(result.current.resolutions.get("One")).toBe("/ws/One.md"));
  });

  it("resolves nothing when the index call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useWikilinkResolutions("[[One]]", "/ws/Doc.md"), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current.resolutions.size).toBe(0);
    errorSpy.mockRestore();
  });

  it("asks nothing when the wikilink extension is off", () => {
    const { result } = renderHook(() => useWikilinkResolutions("[[One]]", "/ws/Doc.md", false), {
      wrapper: Wrapper,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("keeps the current document's answers when older ones land late", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = parkInvoke();
    const { result, rerender } = renderHook(({ path }) => useWikilinkResolutions("[[One]]", path), {
      wrapper: Wrapper,
      initialProps: { path: "/ws/a/Doc.md" },
    });
    rerender({ path: "/ws/b/Doc.md" });
    rerender({ path: "/ws/c/Doc.md" });
    expect(calls).toHaveLength(3);

    await act(async () => calls[2].resolve(["/ws/c/One.md"]));
    await act(async () => {
      calls[0].resolve(["/ws/a/One.md"]);
      calls[1].reject(new Error("denied"));
    });
    expect(result.current.resolutions.get("One")).toBe("/ws/c/One.md");
    errorSpy.mockRestore();
  });

  it("names an unsaved document as such when resolution fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    renderHook(() => useWikilinkResolutions("[[One]]", undefined), { wrapper: Wrapper });
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("the document"),
        expect.any(Error),
      ),
    );
    errorSpy.mockRestore();
  });

  it("drops the answers once the document loses its last link", async () => {
    resolveInOwnFolder();
    const { result, rerender } = renderHook(
      ({ content }) => useWikilinkResolutions(content, "/ws/Doc.md"),
      { wrapper: Wrapper, initialProps: { content: "[[One]]" } },
    );
    await waitFor(() => expect(result.current.resolutions.get("One")).toBe("/ws/One.md"));

    rerender({ content: "no links left" });
    expect(result.current.resolutions.size).toBe(0);
    expect(result.current.pending).toBe(false);
  });

  // A re-index re-runs the effect; a document with nothing to resolve must not
  // re-render for it.
  it("stays settled across a re-index when there is nothing to resolve", () => {
    const { result, rerender } = renderHook(
      () => useWikilinkResolutions("plain prose", "/ws/Doc.md"),
      { wrapper: Wrapper },
    );
    const before = result.current.resolutions;
    context.snapshot = { ...indexed, files: ["/ws/One.md", "/ws/Two.md"] };
    rerender();
    expect(result.current.resolutions).toBe(before);
    expect(invoke).not.toHaveBeenCalled();
  });
});
