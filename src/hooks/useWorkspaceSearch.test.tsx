import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { useWorkspaceSearch } from "@/hooks/useWorkspaceSearch";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function results(total: number) {
  return { files: [], total, truncated: false };
}

function wrapper(root: string | null) {
  const tabs = { workspace: root ? { root } : null } as unknown as TabsContextValue;
  return ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>
  );
}

function renderSearch(root: string | null = "/ws") {
  return renderHook(() => useWorkspaceSearch(), { wrapper: wrapper(root) });
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(results(0));
});

describe("useWorkspaceSearch", () => {
  it("does not scan while the panel is closed", async () => {
    const { result } = renderSearch();
    act(() => result.current.setQuery("needle"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("scans the workspace root with the current query and options", async () => {
    invoke.mockResolvedValue(results(3));
    const { result } = renderSearch();
    act(() => result.current.openPanel());
    act(() => result.current.setQuery("needle"));

    await waitFor(() => expect(result.current.results.total).toBe(3));
    expect(invoke).toHaveBeenLastCalledWith("search_workspace", {
      path: "/ws",
      query: "needle",
      options: { caseSensitive: false, wholeWord: false, regex: false },
    });
  });

  it("re-runs the scan when a toggle flips", async () => {
    const { result } = renderSearch();
    act(() => result.current.openPanel());
    act(() => result.current.setQuery("needle"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.toggleOption("regex"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith("search_workspace", {
      path: "/ws",
      query: "needle",
      options: { caseSensitive: false, wholeWord: false, regex: true },
    });
  });

  it("clears results when the query is emptied, without a round-trip", async () => {
    invoke.mockResolvedValue(results(2));
    const { result } = renderSearch();
    act(() => result.current.openPanel());
    act(() => result.current.setQuery("needle"));
    await waitFor(() => expect(result.current.results.total).toBe(2));

    act(() => result.current.setQuery(""));
    await waitFor(() => expect(result.current.results.total).toBe(0));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("never scans without a workspace", async () => {
    const { result } = renderSearch(null);
    act(() => result.current.openPanel());
    act(() => result.current.setQuery("needle"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports a rejected pattern as a failure and drops stale results", async () => {
    invoke.mockResolvedValue(results(2));
    const { result } = renderSearch();
    act(() => result.current.openPanel());
    act(() => result.current.setQuery("needle"));
    await waitFor(() => expect(result.current.results.total).toBe(2));

    invoke.mockRejectedValue("Invalid search pattern: unclosed group");
    act(() => result.current.setQuery("a("));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.results.total).toBe(0);
    expect(result.current.searching).toBe(false);
  });

  it("ignores a slow scan that resolves after a newer query started", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    invoke.mockResolvedValue(results(9));

    const { result } = renderSearch();
    act(() => result.current.openPanel());
    act(() => result.current.setQuery("slow"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.setQuery("fast"));
    await waitFor(() => expect(result.current.results.total).toBe(9));

    await act(async () => {
      resolveFirst(results(1));
    });
    expect(result.current.results.total).toBe(9);
  });
});
