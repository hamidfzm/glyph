import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_MODE } from "@/lib/settings";
import type { FileState, TabsState } from "@/lib/tabs";
import { useDiskReload } from "./useDiskReload";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/platform", () => ({ isMobilePlatform: () => false }));

/** A clean edit-mode tab on /p/a.md at `revision`, beside a graph tab. */
const stateAt = (revision: number, file: Partial<FileState> = {}): TabsState => ({
  activeTabId: "a",
  tabs: [
    {
      id: "a",
      kind: "file",
      file: {
        path: "/p/a.md",
        content: "old",
        metadata: null,
        scrollTop: 0,
        mode: EDITOR_MODE.edit,
        editContent: "old",
        dirty: false,
        virtual: false,
        revision,
        ...file,
      },
    },
    { id: "g", kind: "graph", root: "/p", file: null },
  ],
});

const unsaved = { dirty: true, editContent: "typed" };

function renderReload(initial: TabsState) {
  const forgetHistory = vi.fn();
  const hook = renderHook(() => {
    const [state, setState] = useState(initial);
    return { state, setState, reload: useDiskReload({ setState, forgetHistory }) };
  });
  return { ...hook, forgetHistory };
}

const contentOf = (state: TabsState) => state.tabs[0].file?.content;
const bufferOf = (state: TabsState) => state.tabs[0].file?.editContent;

describe("useDiskReload", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "read_file" ? "new" : null));
  });

  it("replaces a clean tab's content and buffer with what is on disk", async () => {
    const { result, forgetHistory } = renderReload(stateAt(3));

    await act(async () => {
      await result.current.reload("/p/a.md");
    });

    expect(result.current.state.tabs[0].file).toMatchObject({
      content: "new",
      editContent: "new",
    });
    expect(forgetHistory).toHaveBeenCalledWith("a");
  });

  it("keeps a tab edited since the revision the caller names", async () => {
    const { result } = renderReload(stateAt(3));

    await act(async () => {
      await result.current.reload("/p/a.md", 2);
    });
    expect(contentOf(result.current.state)).toBe("old");

    await act(async () => {
      await result.current.reload("/p/a.md", 3);
    });
    expect(contentOf(result.current.state)).toBe("new");
  });

  it.each(Object.values(EDITOR_MODE))("keeps unsaved edits in %s mode", async (mode) => {
    const { result, forgetHistory } = renderReload(stateAt(3, { ...unsaved, mode }));

    await act(async () => {
      await result.current.reload("/p/a.md");
    });

    expect(result.current.state.tabs[0].file).toMatchObject({
      content: "old",
      editContent: "typed",
    });
    expect(forgetHistory).not.toHaveBeenCalled();
  });

  it("keeps unsaved edits when the revision the caller names still matches", async () => {
    const { result } = renderReload(stateAt(3, unsaved));

    await act(async () => {
      await result.current.reload("/p/a.md", 3);
    });

    expect(bufferOf(result.current.state)).toBe("typed");
  });

  it("keeps an edit made while the file was being read", async () => {
    let finishRead: (content: string) => void = () => {};
    const pendingRead = new Promise<string>((resolve) => {
      finishRead = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "read_file" ? pendingRead : null));
    const { result } = renderReload(stateAt(3, { mode: EDITOR_MODE.view }));

    const reloading = result.current.reload("/p/a.md");
    act(() => {
      result.current.setState(stateAt(4, { ...unsaved, mode: EDITOR_MODE.view }));
    });
    await act(async () => {
      finishRead("new");
      await reloading;
    });

    expect(bufferOf(result.current.state)).toBe("typed");
  });

  it("changes nothing when the read fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("gone"));
    const { result } = renderReload(stateAt(3));

    await act(async () => {
      await result.current.reload("/p/a.md");
    });

    expect(contentOf(result.current.state)).toBe("old");
  });
});
