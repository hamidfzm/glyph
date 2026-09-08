import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { useVaultQuery } from "./useVaultQuery";

function inWorkspace({ children }: { children: ReactNode }) {
  const value = {
    workspace: { root: "/ws" },
    snapshot: EMPTY_SNAPSHOT,
  } as unknown as TabsContextValue;
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

beforeEach(() => {
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

  it("falls back to plain search text when the index call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useVaultQuery("tag:work"), { wrapper: inWorkspace });
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current).toEqual({ filters: [], text: "tag:work", paths: [] });
    errorSpy.mockRestore();
  });
});
