import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { useTaggedPaths } from "./useTaggedPaths";

const paths = ["/ws/spec.md", "/ws/deep/plan.md"];

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useTaggedPaths", () => {
  it("asks the index which files carry the tag", async () => {
    vi.mocked(invoke).mockResolvedValue(paths);
    const { result } = renderHook(() => useTaggedPaths("/ws", "work", EMPTY_SNAPSHOT));
    await waitFor(() => expect(result.current).toEqual(paths));
    expect(invoke).toHaveBeenCalledWith("vault_paths_with_tag", { root: "/ws", tag: "work" });
  });

  it("asks nothing while no tag filters the panel", () => {
    const { result } = renderHook(() => useTaggedPaths("/ws", null, EMPTY_SNAPSHOT));
    expect(result.current).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("degrades to no files when the index call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useTaggedPaths("/ws", "work", EMPTY_SNAPSHOT));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    errorSpy.mockRestore();
  });
});
