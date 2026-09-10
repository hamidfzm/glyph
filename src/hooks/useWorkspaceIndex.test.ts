import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT, type VaultSnapshot } from "@/lib/vault";
import { COMPLETE_SCAN, type FileScan } from "@/lib/workspaceScan";
import { useWorkspaceIndex } from "./useWorkspaceIndex";

const files = (paths: string[]): FileScan => ({ files: paths, status: COMPLETE_SCAN });
const vault = (paths: string[]): VaultSnapshot => ({ ...EMPTY_SNAPSHOT, files: paths });

/**
 * Park each `vault_snapshot` call, so a test can land two walks in the order
 * it chooses. Everything else answers immediately.
 */
function parkSnapshots() {
  const pending: Array<(snapshot: VaultSnapshot) => void> = [];
  vi.mocked(invoke).mockImplementation(((cmd: string, args: { path: string }) => {
    if (cmd === "vault_snapshot") {
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    }
    if (cmd === "list_markdown_files") return Promise.resolve(files([`${args.path}/listed.md`]));
    return Promise.resolve(EMPTY_SNAPSHOT);
  }) as unknown as typeof invoke);
  return pending;
}

function render(root: string | null = "/ws") {
  return renderHook(() => useWorkspaceIndex({ workspaceRoot: root, onWorkspaceNotice: vi.fn() }));
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useWorkspaceIndex", () => {
  it("reads both walks when a workspace opens", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      Promise.resolve(
        cmd === "list_markdown_files" ? files(["/ws/a.md", "/ws/b.ipynb"]) : vault(["/ws/a.md"]),
      )) as unknown as typeof invoke);
    const { result } = render();

    let opened: string[] = [];
    await act(async () => {
      opened = await result.current.scanWorkspace("/ws", () => true);
    });
    // The openable list carries the notebook; the note index does not.
    expect(opened).toEqual(["/ws/a.md", "/ws/b.ipynb"]);
    expect(result.current.workspaceFiles).toEqual(["/ws/a.md", "/ws/b.ipynb"]);
    expect(result.current.snapshot.files).toEqual(["/ws/a.md"]);
  });

  // Two directory changes in quick succession: whichever walk was started last
  // is the current picture, however the two calls happen to return (INV-3).
  it("keeps the newest walk when an older one lands after it", async () => {
    const pending = parkSnapshots();
    const { result } = render();

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = result.current.refreshIndexes("/ws", () => true);
      second = result.current.refreshIndexes("/ws", () => true);
      await waitFor(() => expect(pending).toHaveLength(2));
      pending[1](vault(["/ws/newest.md"]));
      pending[0](vault(["/ws/stale.md"]));
      await Promise.all([first, second]);
    });

    expect(result.current.snapshot.files).toEqual(["/ws/newest.md"]);
  });

  // `vault_refresh` replaces whatever the backend holds, so a snapshot read
  // mid-open would be thrown away by the walk that is still running. The
  // change is remembered and the walk repeated instead: the copy the open
  // built predates the write that triggered the event.
  it("repeats the opening walk when a change lands while it runs", async () => {
    const opened: Array<(snapshot: VaultSnapshot) => void> = [];
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "vault_refresh") {
        return new Promise((resolve) => {
          opened.push(resolve);
        });
      }
      if (cmd === "list_markdown_files") return Promise.resolve(files(["/ws/listed.md"]));
      return Promise.resolve(vault(["/ws/watcher.md"]));
    }) as unknown as typeof invoke);
    const { result } = render();

    await act(async () => {
      const opening = result.current.scanWorkspace("/ws", () => true);
      await waitFor(() => expect(opened).toHaveLength(1));
      // A file lands after the walker passed its folder.
      await result.current.refreshIndexes("/ws", () => true);
      opened[0](vault(["/ws/opened.md"]));
      await opening;
      await waitFor(() => expect(opened).toHaveLength(2));
      opened[1](vault(["/ws/opened.md", "/ws/late.md"]));
    });

    // The re-read goes back to disk, not to the copy the first walk just left.
    expect(invoke).not.toHaveBeenCalledWith("vault_snapshot", { path: "/ws" });
    await waitFor(() =>
      expect(result.current.snapshot.files).toEqual(["/ws/opened.md", "/ws/late.md"]),
    );
  });

  it("drops an in-flight walk when the indexes are cleared under it", async () => {
    const pending = parkSnapshots();
    const { result } = render();

    await act(async () => {
      const refresh = result.current.refreshIndexes("/ws", () => true);
      await waitFor(() => expect(pending).toHaveLength(1));
      result.current.clearIndexes();
      pending[0](vault(["/ws/late.md"]));
      await refresh;
    });

    expect(result.current.snapshot.files).toEqual([]);
  });

  it("drops a walk whose workspace was replaced while it ran", async () => {
    const pending = parkSnapshots();
    const { result } = render();

    await act(async () => {
      const refresh = result.current.refreshIndexes("/ws", () => false);
      await waitFor(() => expect(pending).toHaveLength(1));
      pending[0](vault(["/ws/late.md"]));
      await refresh;
    });

    expect(result.current.snapshot.files).toEqual([]);
    expect(result.current.workspaceFiles).toEqual([]);
  });

  it("releases the backend's copy when the indexes are cleared", () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = render();
    act(() => result.current.clearIndexes());
    expect(invoke).toHaveBeenCalledWith("vault_forget", { path: "/ws" });
  });

  it("clears an explicit root, which is the one being replaced", () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = render("/ws/incoming");
    act(() => result.current.clearIndexes("/ws/outgoing"));
    expect(invoke).toHaveBeenCalledWith("vault_forget", { path: "/ws/outgoing" });
  });

  it("lists no documents when the file walk fails, and says why", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "list_markdown_files"
        ? Promise.reject(new Error("denied"))
        : Promise.resolve(vault(["/ws/a.md"]))) as unknown as typeof invoke);
    const { result } = render();

    await act(async () => {
      await result.current.scanWorkspace("/ws", () => true);
    });
    expect(result.current.workspaceFiles).toEqual([]);
    expect(result.current.snapshot.files).toEqual(["/ws/a.md"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("releases nothing when no workspace was open", () => {
    const { result } = render(null);
    act(() => result.current.clearIndexes());
    expect(invoke).not.toHaveBeenCalledWith("vault_forget", expect.anything());
  });
});
