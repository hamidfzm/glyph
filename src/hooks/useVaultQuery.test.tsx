import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { EMPTY_SNAPSHOT, type VaultSnapshot } from "@/lib/vault";
import { parkInvoke } from "@/test/parkInvoke";
import { useVaultQuery } from "./useVaultQuery";

// Mutable so a test can re-index under the hook the way the provider does.
let snapshot: VaultSnapshot = EMPTY_SNAPSHOT;

function inWorkspace({ children }: { children: ReactNode }) {
  const value = { workspace: { root: "/ws" }, snapshot } as unknown as TabsContextValue;
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

beforeEach(() => {
  snapshot = EMPTY_SNAPSHOT;
  vi.mocked(invoke).mockReset();
});

describe("useVaultQuery", () => {
  it("splits the query through the index", async () => {
    const answer = {
      filters: [{ field: "tag", value: "work" }],
      text: "spec",
      paths: ["/ws/spec.md"],
    };
    vi.mocked(invoke).mockResolvedValue(answer);
    const { result } = renderHook(() => useVaultQuery("tag:work spec"), { wrapper: inWorkspace });
    await waitFor(() => expect(result.current).toEqual(answer));
    expect(invoke).toHaveBeenCalledWith("vault_query", { root: "/ws", query: "tag:work spec" });
  });

  it("treats the whole query as search text without a workspace", () => {
    const { result } = renderHook(() => useVaultQuery("tag:work"));
    expect(result.current).toEqual({ filters: [], text: "tag:work", paths: [] });
    expect(invoke).not.toHaveBeenCalled();
  });

  // Unlike the other hooks this one is deliberately not stamped: emptying the
  // palette between keystrokes is worse than one frame of the previous answer.
  it("keeps the previous answer while the next query is in flight", async () => {
    const first = { filters: [{ field: "tag", value: "work" }], text: "", paths: ["/ws/spec.md"] };
    vi.mocked(invoke)
      .mockResolvedValueOnce(first)
      .mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ q }) => useVaultQuery(q), {
      wrapper: inWorkspace,
      initialProps: { q: "tag:work" },
    });
    await waitFor(() => expect(result.current).toEqual(first));

    rerender({ q: "tag:work spec" });
    expect(result.current).toEqual(first);
  });

  it("re-asks when the index changes, since a new field can change the parse", async () => {
    vi.mocked(invoke).mockResolvedValue({ filters: [], text: "status:draft", paths: [] });
    const { rerender } = renderHook(() => useVaultQuery("status:draft"), { wrapper: inWorkspace });
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    snapshot = { ...EMPTY_SNAPSHOT, fieldNames: ["status"] };
    rerender();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("falls back to plain search text when the index call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useVaultQuery("tag:work"), { wrapper: inWorkspace });
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current).toEqual({ filters: [], text: "tag:work", paths: [] });
    errorSpy.mockRestore();
  });

  it("keeps the current query's answer when older ones land late", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = parkInvoke();
    const { result, rerender } = renderHook(({ q }) => useVaultQuery(q), {
      wrapper: inWorkspace,
      initialProps: { q: "tag:a" },
    });
    rerender({ q: "tag:b" });
    rerender({ q: "tag:c" });
    expect(calls).toHaveLength(3);

    const latest = { filters: [{ field: "tag", value: "c" }], text: "", paths: ["/ws/c.md"] };
    await act(async () => calls[2].resolve(latest));
    await act(async () => {
      calls[0].resolve({ filters: [], text: "stale", paths: [] });
      calls[1].reject(new Error("denied"));
    });
    expect(result.current).toEqual(latest);
    errorSpy.mockRestore();
  });
});
