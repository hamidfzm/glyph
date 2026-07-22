import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { useCreateWikilinkNote } from "./useCreateWikilinkNote";

// Minimal context stubs, like renderInWorkspace: only the fields the hook reads.
function wrapperFor(tabs: object | null) {
  const value = tabs as unknown as TabsContextValue | null;
  return ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
  );
}

describe("useCreateWikilinkNote", () => {
  it("returns null without an open workspace, so the affordance stays hidden", () => {
    const { result } = renderHook(() => useCreateWikilinkNote(), { wrapper: wrapperFor(null) });
    expect(result.current).toBeNull();
  });

  it("no-ops when the workspace context cannot create files", async () => {
    const openFile = vi.fn();
    const { result } = renderHook(() => useCreateWikilinkNote(), {
      // A root but no create/rename API: the callback exists and must bail out
      // rather than throw on the missing commands.
      wrapper: wrapperFor({ workspace: { root: "/w" }, openFile }),
    });

    await act(async () => {
      await result.current?.("Missing");
    });
    expect(openFile).not.toHaveBeenCalled();
  });

  it("stops when the note cannot be created", async () => {
    const createNote = vi.fn().mockResolvedValue(null);
    const renamePath = vi.fn();
    const openFile = vi.fn();
    const { result } = renderHook(() => useCreateWikilinkNote(), {
      wrapper: wrapperFor({
        workspace: { root: "/w" },
        createNote,
        renamePath,
        openFile,
      }),
    });

    await act(async () => {
      await result.current?.("Missing");
    });
    expect(createNote).toHaveBeenCalledWith("/w");
    expect(renamePath).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("opens the created note when the rename fails", async () => {
    const createNote = vi.fn().mockResolvedValue("/w/Untitled.md");
    const renamePath = vi.fn().mockResolvedValue(null);
    const openFile = vi.fn();
    const { result } = renderHook(() => useCreateWikilinkNote(), {
      wrapper: wrapperFor({
        workspace: { root: "/w" },
        createNote,
        renamePath,
        openFile,
      }),
    });

    await act(async () => {
      await result.current?.("Missing");
    });
    // Falls back to the untitled path so the new note still opens.
    expect(openFile).toHaveBeenCalledWith("/w/Untitled.md");
  });
});
