import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureListener,
  defaultOptions,
  fileScan,
  makeInvoker,
  metadataScan,
  resetTabsMocks,
} from "@/test/tabsHarness";
import { useTabs } from "./useTabs";

vi.mock("@/lib/pickers", () => ({
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  pickSave: vi.fn(),
  pickNewWorkspace: vi.fn(),
}));

beforeEach(resetTabsMocks);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTabs file-changed events", () => {
  it("ignores file-changed when autoReload is off", async () => {
    let body = "v1";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: false })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("v1");
    }
  });

  it("ignores file-changed for a path with no open tab", async () => {
    const fileChanged = captureListener("file-changed");
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    await act(async () => {
      fileChanged.handler?.({ payload: "/p/other.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(invoke).not.toHaveBeenCalledWith("read_file", { path: "/p/other.md" });
  });

  it("skips the reload triggered by our own recent save", async () => {
    let body = "- [ ] task";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({ read_file: async () => body }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/tasks.md");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.toggleTask(tabId, 1);
    });

    // The watcher echoes our own write within the grace window; the reload is
    // suppressed so the toggled content is kept even though disk says otherwise.
    body = "DISK STATE";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/tasks.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("- [x] task");
    }
  });

  it("keeps the current content when the reload read fails", async () => {
    let fail = false;
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => {
          if (fail) throw new Error("io error");
          return "v1";
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFile("/p/a.md");
    });

    fail = true;
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    if (result.current.tabs[0].kind === "file") {
      expect(result.current.tabs[0].file.content).toBe("v1");
    }
  });

  it("reloads the matching file tab and leaves the graph tab alone", async () => {
    let body = "v1";
    const fileChanged = captureListener("file-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_file: async () => body,
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions({ autoReload: true })));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    act(() => {
      result.current.openGraph();
    });
    await act(async () => {
      await result.current.openFile("/p/ws/a.md");
    });

    body = "v2";
    await act(async () => {
      fileChanged.handler?.({ payload: "/p/ws/a.md" });
      await new Promise((r) => setTimeout(r, 350));
    });

    const fileTab = result.current.tabs.find((t) => t.kind === "file");
    expect(fileTab?.kind === "file" ? fileTab.file.content : null).toBe("v2");
    expect(result.current.tabs.some((t) => t.kind === "graph")).toBe(true);
  });
});

describe("useTabs directory-changed events", () => {
  it("refreshes the workspace tree and rebuilds the workspace indices", async () => {
    const dirChanged = captureListener("directory-changed");
    let files: string[] = [];
    let tagged: unknown[] = [];
    let rootEntries = [{ name: "sub", path: "/p/ws/sub", isDirectory: true, modified: 0 }];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) =>
          String(args?.path ?? "") === "/p/ws" ? rootEntries : [],
        list_markdown_files: async () => fileScan(files),
        scan_metadata: async () => metadataScan(tagged),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    // Load a subdirectory so the refresh sweep covers cached child listings too.
    await act(async () => {
      await result.current.toggleExpand("/p/ws/sub");
    });

    // Something outside the app adds a file.
    files = ["/p/ws/new.md"];
    tagged = [{ path: "/p/ws/new.md", frontmatter: null, tags: ["work"] }];
    rootEntries = [
      ...rootEntries,
      { name: "new.md", path: "/p/ws/new.md", isDirectory: false, modified: 0 },
    ];
    await act(async () => {
      // Fire twice in quick succession: the second event resets the debounce
      // timer rather than scheduling a parallel refresh.
      dirChanged.handler?.({ payload: "/p/ws" });
      dirChanged.handler?.({ payload: "/p/ws" });
      await new Promise((r) => setTimeout(r, 350));
    });

    const rootListing = result.current.workspace?.nodes.get("/p/ws");
    expect(rootListing?.some((e) => e.path === "/p/ws/new.md")).toBe(true);
    expect(result.current.workspace?.nodes.has("/p/ws/sub")).toBe(true);
    await waitFor(() => {
      expect(result.current.workspaceFiles).toEqual(["/p/ws/new.md"]);
    });
    expect(result.current.metadataEntries).toEqual(tagged);
  });

  it("drops a refresh that lands after the workspace was replaced", async () => {
    const dirChanged = captureListener("directory-changed");
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        list_markdown_files: async (_cmd, args) =>
          fileScan(String(args?.path ?? "") === "/p/ws" ? ["/p/ws/a.md"] : []),
        scan_metadata: async (_cmd, args) =>
          metadataScan(
            String(args?.path ?? "") === "/p/ws"
              ? [{ path: "/p/ws/a.md", frontmatter: null, tags: ["work"] }]
              : [],
          ),
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    await waitFor(() => expect(result.current.metadataEntries).toHaveLength(1));

    // The rescan of /p/ws is still in flight when the window switches to
    // /p/other; its results must not land on the new workspace.
    await act(async () => {
      dirChanged.handler?.({ payload: "/p/ws" });
      await result.current.openFolder("/p/other");
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(result.current.workspace?.root).toBe("/p/other");
    expect(result.current.workspaceFiles).toEqual([]);
    expect(result.current.metadataEntries).toEqual([]);
  });

  it("ignores directory-changed for a root that isn't open", async () => {
    const dirChanged = captureListener("directory-changed");
    const readDirs: string[] = [];
    vi.mocked(invoke).mockImplementation(
      makeInvoker({
        read_directory: async (_cmd, args) => {
          readDirs.push(String(args?.path ?? ""));
          return [];
        },
      }) as typeof invoke,
    );
    const { result } = renderHook(() => useTabs(defaultOptions()));
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => {
      await result.current.openFolder("/p/ws");
    });
    const readsBefore = readDirs.length;

    await act(async () => {
      dirChanged.handler?.({ payload: "/p/other" });
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(readDirs.length).toBe(readsBefore);
  });
});
