import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileLoader } from "./useFileLoader";

const META = { name: "doc.md", path: "/p/doc.md", size: 4, modified: 0 };

type InvokeArgs = { path: string };

function setupInvokes({
  initialFile = null,
  content = "hello",
  metadata = META,
  readError,
}: {
  initialFile?: string | null;
  content?: string;
  metadata?: typeof META;
  readError?: string;
} = {}) {
  vi.mocked(invoke).mockImplementation(((cmd: string, _args?: InvokeArgs) => {
    if (cmd === "get_initial_file") return Promise.resolve(initialFile);
    if (cmd === "read_file") {
      return readError ? Promise.reject(readError) : Promise.resolve(content);
    }
    if (cmd === "get_file_metadata") return Promise.resolve(metadata);
    if (cmd === "watch_file") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  }) as typeof invoke);
}

describe("useFileLoader", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(open).mockReset();
  });

  it("loads the initial file from CLI args on mount", async () => {
    setupInvokes({ initialFile: "/p/initial.md" });
    const { result } = renderHook(() => useFileLoader());
    await waitFor(() => {
      expect(result.current.content).toBe("hello");
    });
    expect(result.current.metadata?.path).toBe("/p/doc.md");
    expect(result.current.initializing).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(invoke).toHaveBeenCalledWith("read_file", { path: "/p/initial.md" });
    expect(invoke).toHaveBeenCalledWith("watch_file", { path: "/p/initial.md" });
  });

  it("falls back to recent[0] when reopenLastFile is set and no CLI file", async () => {
    setupInvokes({ initialFile: null });
    const onRecentFilesChange = vi.fn();
    const { result } = renderHook(() =>
      useFileLoader({
        reopenLastFile: true,
        recentFiles: ["/p/recent.md"],
        onRecentFilesChange,
      }),
    );
    await waitFor(() => {
      expect(result.current.content).toBe("hello");
    });
    expect(invoke).toHaveBeenCalledWith("read_file", { path: "/p/recent.md" });
  });

  it("clears initializing without loading when no CLI file and no recent", async () => {
    setupInvokes({ initialFile: null });
    const { result } = renderHook(() =>
      useFileLoader({ reopenLastFile: true, recentFiles: [] }),
    );
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(result.current.content).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("read_file", expect.anything());
  });

  it("returns initializing=false when get_initial_file rejects", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "get_initial_file") return Promise.reject(new Error("nope"));
      return Promise.resolve(undefined);
    }) as typeof invoke);

    const { result } = renderHook(() => useFileLoader());
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(result.current.content).toBeNull();
  });

  it("sets error state when read_file rejects", async () => {
    setupInvokes({ initialFile: "/p/bad.md", readError: "boom" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useFileLoader());
    await waitFor(() => {
      expect(result.current.error).toBe("boom");
    });
    expect(result.current.content).toBeNull();
    expect(result.current.loading).toBe(false);
    errSpy.mockRestore();
  });

  it("updates recent files when a new file is loaded", async () => {
    setupInvokes({ initialFile: null });
    const onRecentFilesChange = vi.fn();
    const { result } = renderHook(() =>
      useFileLoader({
        recentFiles: ["/p/old.md"],
        onRecentFilesChange,
      }),
    );
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });

    await act(async () => {
      await result.current.loadFile("/p/new.md");
    });

    expect(onRecentFilesChange).toHaveBeenLastCalledWith(["/p/new.md", "/p/old.md"]);
  });

  it("dedupes recent files and caps the list at 10 entries", async () => {
    setupInvokes({ initialFile: null });
    const recent = Array.from({ length: 10 }, (_, i) => `/p/${i}.md`);
    const onRecentFilesChange = vi.fn();
    const { result } = renderHook(() =>
      useFileLoader({
        recentFiles: recent,
        onRecentFilesChange,
      }),
    );
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });

    await act(async () => {
      await result.current.loadFile("/p/5.md");
    });

    const updated = onRecentFilesChange.mock.calls.at(-1)?.[0] as string[];
    expect(updated).toHaveLength(10);
    expect(updated[0]).toBe("/p/5.md");
    expect(updated.filter((f) => f === "/p/5.md")).toHaveLength(1);
  });

  it("openFileDialog loads the selected file", async () => {
    setupInvokes({ initialFile: null });
    vi.mocked(open).mockResolvedValue("/p/picked.md");

    const { result } = renderHook(() => useFileLoader());
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });

    await act(async () => {
      await result.current.openFileDialog();
    });

    expect(open).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("read_file", { path: "/p/picked.md" });
  });

  it("openFileDialog is a no-op when the user cancels", async () => {
    setupInvokes({ initialFile: null });
    vi.mocked(open).mockResolvedValue(null);

    const { result } = renderHook(() => useFileLoader());
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });

    await act(async () => {
      await result.current.openFileDialog();
    });

    expect(invoke).not.toHaveBeenCalledWith("read_file", expect.anything());
  });

  it("loads the file payload from the open-file event", async () => {
    setupInvokes({ initialFile: null });

    let handler: ((event: { payload: string }) => void) | null = null;
    vi.mocked(listen).mockImplementation(((
      eventName: string,
      fn: (event: { payload: string }) => void,
    ) => {
      if (eventName === "open-file") handler = fn;
      return Promise.resolve(() => {});
    }) as typeof listen);

    const { result } = renderHook(() => useFileLoader());
    await waitFor(() => {
      expect(result.current.initializing).toBe(false);
    });
    expect(handler).not.toBeNull();

    await act(async () => {
      handler?.({ payload: "/p/event.md" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("read_file", { path: "/p/event.md" });
    });
  });
});
