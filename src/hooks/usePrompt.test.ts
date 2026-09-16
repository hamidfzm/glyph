import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePrompt } from "./usePrompt";

type Choice = "save" | "discard" | "cancel";

const renderPrompt = () => renderHook(() => usePrompt<string[], Choice>("cancel"));

describe("usePrompt", () => {
  it("exposes the request and resolves with the chosen answer", async () => {
    const { result } = renderPrompt();
    expect(result.current.request).toBeNull();

    let choice: Promise<Choice> | undefined;
    act(() => {
      choice = result.current.confirm(["/p/a.md", "/p/b.md"]);
    });
    expect(result.current.request).toEqual(["/p/a.md", "/p/b.md"]);

    act(() => {
      result.current.choose("discard");
    });
    await expect(choice).resolves.toBe("discard");
    // The prompt closes once answered, so a later request starts from scratch.
    expect(result.current.request).toBeNull();
  });

  it("answers a second request as dismissed while a prompt is open", async () => {
    const { result } = renderPrompt();
    let first: Promise<Choice> | undefined;
    act(() => {
      first = result.current.confirm(["/p/a.md"]);
    });

    // A stacked request aborts rather than replacing the open prompt.
    await expect(result.current.confirm(["/p/b.md"])).resolves.toBe("cancel");
    expect(result.current.request).toEqual(["/p/a.md"]);

    act(() => {
      result.current.choose("save");
    });
    await expect(first).resolves.toBe("save");
  });

  it("dismisses a pending prompt on unmount so the caller never hangs", async () => {
    const { result, unmount } = renderPrompt();
    let choice: Promise<Choice> | undefined;
    act(() => {
      choice = result.current.confirm(["/p/a.md"]);
    });

    unmount();

    // An error boundary swapping out the tree must not park the intercepted
    // window close on a promise nothing can resolve.
    await expect(choice).resolves.toBe("cancel");
  });

  it("ignores an answer given with no prompt open", () => {
    const { result } = renderPrompt();
    expect(() => act(() => result.current.choose("save"))).not.toThrow();
    expect(result.current.request).toBeNull();
  });
});
