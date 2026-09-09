import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";

/** An index holding notes; an empty one carries no tags to ask about. */
const indexed = { ...EMPTY_SNAPSHOT, files: ["/ws/spec.md", "/ws/deep/plan.md"] };

import { useTaggedPaths } from "./useTaggedPaths";

const paths = ["/ws/spec.md", "/ws/deep/plan.md"];

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useTaggedPaths", () => {
  it("asks the index which files carry the tag", async () => {
    vi.mocked(invoke).mockResolvedValue(paths);
    const { result } = renderHook(() => useTaggedPaths("/ws", "work", indexed));
    await waitFor(() => expect(result.current).toEqual(paths));
    expect(invoke).toHaveBeenCalledWith("vault_paths_with_tag", { root: "/ws", tag: "work" });
  });

  it("asks nothing while no tag filters the panel", () => {
    const { result } = renderHook(() => useTaggedPaths("/ws", null, indexed));
    expect(result.current).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  // Picking another chip must empty the list rather than show the previous
  // tag's files under the new one (INV-3).
  it("shows nothing for the new tag until its own files arrive", async () => {
    const tagged: Record<string, string[]> = { work: paths, personal: ["/ws/diary.md"] };
    vi.mocked(invoke).mockImplementation(((_cmd: string, args: { tag: string }) =>
      Promise.resolve(tagged[args.tag] ?? [])) as unknown as typeof invoke);
    const { result, rerender } = renderHook(({ tag }) => useTaggedPaths("/ws", tag, indexed), {
      initialProps: { tag: "work" },
    });
    await waitFor(() => expect(result.current).toEqual(paths));

    rerender({ tag: "personal" });
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(["/ws/diary.md"]));
  });

  it("degrades to no files when the index call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useTaggedPaths("/ws", "work", indexed));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    errorSpy.mockRestore();
  });
});
