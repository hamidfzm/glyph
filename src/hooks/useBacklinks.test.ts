import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";

/** An index holding notes; an empty one is nothing to ask about. */
const indexed = { ...EMPTY_SNAPSHOT, files: ["/ws/Note.md", "/ws/Other.md"] };

import { parkInvoke } from "@/test/parkInvoke";
import { useBacklinks } from "./useBacklinks";

const rows = [{ source: "/ws/Index.md", line: 3, snippet: "see [[Note]]" }];

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useBacklinks", () => {
  it("asks the index for the note's inbound links", async () => {
    vi.mocked(invoke).mockResolvedValue(rows);
    const { result } = renderHook(() => useBacklinks("/ws", "/ws/Note.md", indexed));
    await waitFor(() => expect(result.current).toEqual(rows));
    expect(invoke).toHaveBeenCalledWith("vault_backlinks", { root: "/ws", path: "/ws/Note.md" });
  });

  it("asks nothing when no workspace is open", () => {
    const { result } = renderHook(() => useBacklinks(undefined, "/ws/Note.md", indexed));
    expect(result.current).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  // Switching notes must empty the panel rather than leave the previous note's
  // inbound links under the new note's heading (INV-3).
  it("shows nothing for the new note until its own rows arrive", async () => {
    const answers: Record<string, typeof rows> = {
      "/ws/Note.md": rows,
      "/ws/Other.md": [{ source: "/ws/Deep.md", line: 9, snippet: "see [[Other]]" }],
    };
    vi.mocked(invoke).mockImplementation(((_cmd: string, args: { path: string }) =>
      Promise.resolve(answers[args.path] ?? [])) as unknown as typeof invoke);
    const { result, rerender } = renderHook(({ path }) => useBacklinks("/ws", path, indexed), {
      initialProps: { path: "/ws/Note.md" },
    });
    await waitFor(() => expect(result.current).toEqual(rows));

    rerender({ path: "/ws/Other.md" });
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(answers["/ws/Other.md"]));
  });

  it("degrades to no backlinks when the index call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useBacklinks("/ws", "/ws/Note.md", indexed));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    errorSpy.mockRestore();
  });

  // The current note's rows land first; a slower answer for a note the panel
  // already left, rows or failure, must not replace them (INV-3).
  it("keeps the current note's rows when older answers land late", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = parkInvoke();
    const { result, rerender } = renderHook(({ path }) => useBacklinks("/ws", path, indexed), {
      initialProps: { path: "/ws/Note.md" },
    });
    rerender({ path: "/ws/Other.md" });
    rerender({ path: "/ws/Third.md" });
    expect(calls).toHaveLength(3);

    await act(async () => calls[2].resolve(rows));
    await act(async () => {
      calls[0].resolve([{ source: "/ws/Stale.md", line: 1, snippet: "stale" }]);
      calls[1].reject(new Error("denied"));
    });
    expect(result.current).toEqual(rows);
    errorSpy.mockRestore();
  });
});
