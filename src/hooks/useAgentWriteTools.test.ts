import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentWriteTools } from "@/hooks/useAgentWriteTools";
import { deferred } from "@/test/deferred";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("useAgentWriteTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the tools the backend names", async () => {
    vi.mocked(invoke).mockResolvedValue(["patch_note", "move_note"]);
    const { result } = renderHook(() => useAgentWriteTools());

    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(["patch_note", "move_note"]));
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_write_tools");
  });

  it("lists nothing where the command does not exist", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("command agent_write_tools not found"));
    const { result } = renderHook(() => useAgentWriteTools());

    await Promise.resolve();
    expect(result.current).toEqual([]);
  });

  it("ignores an answer that is not a list", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAgentWriteTools());

    await Promise.resolve();
    expect(result.current).toEqual([]);
  });

  it("drops an answer that lands after the settings closed", async () => {
    const answer = deferred<string[]>();
    vi.mocked(invoke).mockReturnValue(answer.promise);
    const { result, unmount } = renderHook(() => useAgentWriteTools());

    unmount();
    answer.resolve(["patch_note"]);
    await answer.promise;
    expect(result.current).toEqual([]);
  });
});
