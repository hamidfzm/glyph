import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_MODE } from "@/lib/settings";
import type { TabsState } from "@/lib/tabs";
import { useDiskReload } from "./useDiskReload";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/platform", () => ({ isMobilePlatform: () => false }));

/** An edit-mode tab on /p/a.md at `revision`, beside a graph tab. */
const stateAt = (revision: number, dirty = false): TabsState => ({
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
        dirty,
        virtual: false,
        revision,
      },
    },
    { id: "g", kind: "graph", root: "/p", file: null },
  ],
});

function renderReload(initial: TabsState) {
  const forgetHistory = vi.fn();
  const hook = renderHook(() => {
    const [state, setState] = useState(initial);
    return { state, reload: useDiskReload({ setState, forgetHistory }) };
  });
  return { ...hook, forgetHistory };
}

const contentOf = (state: TabsState) => state.tabs[0].file?.content;

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

  it("keeps unsaved edits, and a failed read changes nothing", async () => {
    const { result } = renderReload(stateAt(3, true));

    await act(async () => {
      await result.current.reload("/p/a.md");
    });
    expect(contentOf(result.current.state)).toBe("old");

    vi.mocked(invoke).mockRejectedValue(new Error("gone"));
    await act(async () => {
      await result.current.reload("/p/a.md");
    });
    expect(contentOf(result.current.state)).toBe("old");
  });
});
