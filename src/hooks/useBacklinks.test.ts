import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { useBacklinks } from "./useBacklinks";

const rows = [{ source: "/ws/Index.md", line: 3, snippet: "see [[Note]]" }];

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useBacklinks", () => {
  it("asks the index for the note's inbound links", async () => {
    vi.mocked(invoke).mockResolvedValue(rows);
    const { result } = renderHook(() => useBacklinks("/ws", "/ws/Note.md", EMPTY_SNAPSHOT));
    await waitFor(() => expect(result.current).toEqual(rows));
    expect(invoke).toHaveBeenCalledWith("vault_backlinks", { root: "/ws", path: "/ws/Note.md" });
  });

  it("asks nothing when no workspace is open", () => {
    const { result } = renderHook(() => useBacklinks(undefined, "/ws/Note.md", EMPTY_SNAPSHOT));
    expect(result.current).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("degrades to no backlinks when the index call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useBacklinks("/ws", "/ws/Note.md", EMPTY_SNAPSHOT));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    errorSpy.mockRestore();
  });
});
