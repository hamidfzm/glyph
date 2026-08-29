import { load } from "@tauri-apps/plugin-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSessionRestore,
  endSessionRestore,
  flushWorkspaceSessions,
  getWorkspaceSession,
  isSessionRestoring,
  MAX_WORKSPACE_SESSIONS,
  resetWorkspaceSessions,
  saveWorkspaceSession,
  type WorkspaceSession,
} from "./workspaceSession";

function session(over: Partial<WorkspaceSession> = {}): WorkspaceSession {
  return {
    tabs: [{ kind: "file", path: "/ws/a.md" }],
    activeTabPath: "/ws/a.md",
    expanded: [],
    scroll: {},
    zoom: {},
    savedAt: 100,
    ...over,
  };
}

type StoreMock = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  entries: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  length: ReturnType<typeof vi.fn>;
};

function storeMock(over: Partial<StoreMock> = {}): StoreMock {
  return {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
    entries: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve(true)),
    length: vi.fn(() => Promise.resolve(0)),
    ...over,
  };
}

function mockStore(over: Partial<StoreMock> = {}): StoreMock {
  const store = storeMock(over);
  vi.mocked(load).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof load>>);
  return store;
}

beforeEach(() => {
  resetWorkspaceSessions();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetWorkspaceSessions();
});

describe("workspaceSession store", () => {
  it("returns null for a workspace that was never saved", async () => {
    mockStore();
    await expect(getWorkspaceSession("/ws")).resolves.toBeNull();
  });

  it("round-trips a stored snapshot", async () => {
    const stored = session({
      sidebar: { filesSidebarVisible: false, outlineSidebarVisible: true },
    });
    mockStore({ get: vi.fn(() => Promise.resolve(stored)) });
    await expect(getWorkspaceSession("/ws")).resolves.toEqual(stored);
  });

  it("returns null for a corrupt entry instead of a broken snapshot", async () => {
    mockStore({ get: vi.fn(() => Promise.resolve({ tabs: "not-an-array" })) });
    await expect(getWorkspaceSession("/ws")).resolves.toBeNull();
  });

  it("fills missing fields of a partial snapshot instead of handing back holes", async () => {
    // An interrupted write or older build can leave a snapshot without its
    // maps; a restore must not throw on session.scroll[path].
    mockStore({ get: vi.fn(() => Promise.resolve({ tabs: [] })) });
    const session = await getWorkspaceSession("/ws");
    expect(session).toEqual({
      tabs: [],
      activeTabPath: "",
      expanded: [],
      scroll: {},
      zoom: {},
      savedAt: 0,
    });
  });

  it("reads a queued write before it is flushed, so a rapid switch-back sees its own data", async () => {
    mockStore();
    const queued = session();
    saveWorkspaceSession("/ws", queued);
    await expect(getWorkspaceSession("/ws")).resolves.toEqual(queued);
  });

  it("debounces writes and persists the latest snapshot per workspace", async () => {
    const store = mockStore();
    saveWorkspaceSession("/ws", session({ activeTabPath: "old" }));
    saveWorkspaceSession("/ws", session({ activeTabPath: "new" }));
    expect(store.set).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);

    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith(
      "/ws",
      expect.objectContaining({ activeTabPath: "new" }),
    );
    expect(store.save).toHaveBeenCalled();
  });

  it("writes each workspace under its own key, so two windows never clobber each other", async () => {
    const store = mockStore();
    saveWorkspaceSession("/a", session({ activeTabPath: "/a/x.md" }));
    saveWorkspaceSession("/b", session({ activeTabPath: "/b/y.md" }));

    await flushWorkspaceSessions();

    expect(store.set).toHaveBeenCalledWith(
      "/a",
      expect.objectContaining({ activeTabPath: "/a/x.md" }),
    );
    expect(store.set).toHaveBeenCalledWith(
      "/b",
      expect.objectContaining({ activeTabPath: "/b/y.md" }),
    );
  });

  it("flush writes queued snapshots immediately, cancelling the debounce", async () => {
    const store = mockStore();
    saveWorkspaceSession("/ws", session());

    await flushWorkspaceSessions();

    expect(store.set).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(store.set).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing queued writes nothing", async () => {
    const store = mockStore();
    await flushWorkspaceSessions();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("prunes the least recently saved entries beyond the cap", async () => {
    const stale = Array.from({ length: MAX_WORKSPACE_SESSIONS + 2 }, (_, i) => [
      `/ws${i}`,
      session({ savedAt: i }),
    ]);
    const store = mockStore({
      entries: vi.fn(() => Promise.resolve(stale)),
      length: vi.fn(() => Promise.resolve(stale.length)),
    });
    saveWorkspaceSession("/fresh", session({ savedAt: 9999 }));

    await flushWorkspaceSessions();

    expect(store.delete).toHaveBeenCalledTimes(2);
    expect(store.delete).toHaveBeenCalledWith("/ws0");
    expect(store.delete).toHaveBeenCalledWith("/ws1");
  });

  it("treats a null or stamp-less entry as oldest when pruning", async () => {
    const stale: [string, unknown][] = [
      ["/null-entry", null],
      ["/no-stamp", { tabs: [] }],
    ];
    for (let i = 0; i < MAX_WORKSPACE_SESSIONS - 1; i += 1) {
      stale.push([`/ws${i}`, session({ savedAt: i + 1 })]);
    }
    const store = mockStore({
      entries: vi.fn(() => Promise.resolve(stale)),
      length: vi.fn(() => Promise.resolve(stale.length)),
    });
    saveWorkspaceSession("/fresh", session({ savedAt: 9999 }));

    await flushWorkspaceSessions();

    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(store.delete).toHaveBeenCalledWith("/null-entry");
  });

  it("skips the entries scan entirely while the store is under the cap", async () => {
    const store = mockStore({ length: vi.fn(() => Promise.resolve(3)) });
    saveWorkspaceSession("/ws", session());

    await flushWorkspaceSessions();

    expect(store.entries).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("never writes over an entry it failed to read", async () => {
    // INV-2: a failed read is not an empty session. Overwriting it with the
    // fallback one-tab strip would destroy the user's real snapshot.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = mockStore({ get: vi.fn(() => Promise.reject(new Error("bad entry"))) });

    await expect(getWorkspaceSession("/ws")).resolves.toBeNull();
    saveWorkspaceSession("/ws", session());
    saveWorkspaceSession("/other", session());
    await flushWorkspaceSessions();

    expect(store.set).not.toHaveBeenCalledWith("/ws", expect.anything());
    expect(store.set).toHaveBeenCalledWith("/other", expect.anything());
    errSpy.mockRestore();
  });

  it("degrades to null snapshots with a logged error when the store cannot load", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(load).mockRejectedValue(new Error("disk broke"));

    await expect(getWorkspaceSession("/ws")).resolves.toBeNull();
    saveWorkspaceSession("/ws", session());
    await flushWorkspaceSessions();

    expect(errSpy).toHaveBeenCalledWith("Failed to load workspace sessions:", expect.any(Error));
    errSpy.mockRestore();
  });

  it("logs and keeps going when a read throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStore({ get: vi.fn(() => Promise.reject(new Error("bad entry"))) });

    await expect(getWorkspaceSession("/ws")).resolves.toBeNull();

    expect(errSpy).toHaveBeenCalledWith("Failed to read the workspace session:", expect.any(Error));
    errSpy.mockRestore();
  });

  it("logs and keeps going when a write fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStore({ set: vi.fn(() => Promise.reject(new Error("full disk"))) });
    saveWorkspaceSession("/ws", session());

    await flushWorkspaceSessions();

    expect(errSpy).toHaveBeenCalledWith("Failed to save workspace sessions:", expect.any(Error));
    errSpy.mockRestore();
  });

  it("tracks restore depth as a counter so nested begins do not unlatch early", () => {
    expect(isSessionRestoring()).toBe(false);
    beginSessionRestore();
    beginSessionRestore();
    endSessionRestore();
    expect(isSessionRestoring()).toBe(true);
    endSessionRestore();
    expect(isSessionRestoring()).toBe(false);
    // An unbalanced end never goes negative.
    endSessionRestore();
    expect(isSessionRestoring()).toBe(false);
  });
});
