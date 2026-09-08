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

function render(root = "/ws") {
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

  // `vault_refresh` replaces whatever the backend holds, so a snapshot built
  // from a watcher event mid-open would be discarded and its file never
  // re-read.
  it("ignores a watcher refresh while the opening walk is in flight", async () => {
    let releaseOpen: ((snapshot: VaultSnapshot) => void) | null = null;
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "vault_refresh") {
        return new Promise((resolve) => {
          releaseOpen = resolve;
        });
      }
      if (cmd === "list_markdown_files") return Promise.resolve(files([]));
      return Promise.resolve(vault(["/ws/watcher.md"]));
    }) as unknown as typeof invoke);
    const { result } = render();

    await act(async () => {
      const opening = result.current.scanWorkspace("/ws", () => true);
      await result.current.refreshIndexes("/ws", () => true);
      releaseOpen?.(vault(["/ws/opened.md"]));
      await opening;
    });

    expect(invoke).not.toHaveBeenCalledWith("vault_snapshot", { path: "/ws" });
    expect(result.current.snapshot.files).toEqual(["/ws/opened.md"]);
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
});
