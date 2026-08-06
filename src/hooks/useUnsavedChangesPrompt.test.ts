import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUnsavedChangesPrompt } from "./useUnsavedChangesPrompt";

describe("useUnsavedChangesPrompt", () => {
  it("exposes the requested files and resolves with the chosen action", async () => {
    const { result } = renderHook(() => useUnsavedChangesPrompt());
    expect(result.current.files).toBeNull();

    let choice: Promise<string> | undefined;
    act(() => {
      choice = result.current.confirm(["/p/a.md", "/p/b.md"]);
    });
    expect(result.current.files).toEqual(["/p/a.md", "/p/b.md"]);

    act(() => {
      result.current.choose("discard");
    });
    await expect(choice).resolves.toBe("discard");
    // The prompt closes once answered, so a later close starts from scratch.
    expect(result.current.files).toBeNull();
  });

  it("answers a second request with cancel while a prompt is open", async () => {
    const { result } = renderHook(() => useUnsavedChangesPrompt());
    let first: Promise<string> | undefined;
    act(() => {
      first = result.current.confirm(["/p/a.md"]);
    });

    // A stacked close aborts rather than replacing the open prompt.
    await expect(result.current.confirm(["/p/b.md"])).resolves.toBe("cancel");
    expect(result.current.files).toEqual(["/p/a.md"]);

    act(() => {
      result.current.choose("save");
    });
    await expect(first).resolves.toBe("save");
  });

  it("cancels a pending prompt on unmount so the close never hangs", async () => {
    const { result, unmount } = renderHook(() => useUnsavedChangesPrompt());
    let choice: Promise<string> | undefined;
    act(() => {
      choice = result.current.confirm(["/p/a.md"]);
    });

    unmount();

    // An error boundary swapping out the tree must not park the intercepted
    // window close on a promise nothing can resolve.
    await expect(choice).resolves.toBe("cancel");
  });

  it("ignores a choice made with no prompt open", () => {
    const { result } = renderHook(() => useUnsavedChangesPrompt());
    expect(() => act(() => result.current.choose("save"))).not.toThrow();
    expect(result.current.files).toBeNull();
  });
});
