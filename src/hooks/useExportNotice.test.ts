import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useExportNotice } from "./useExportNotice";

describe("useExportNotice", () => {
  it("starts with nothing to show", () => {
    const { result } = renderHook(() => useExportNotice());
    expect(result.current.notice).toBeNull();
  });

  it("shows a notice until it is dismissed", () => {
    const { result } = renderHook(() => useExportNotice());
    act(() => result.current.showNotice({ kind: "failed", reason: "disk full" }));
    expect(result.current.notice).toEqual({ kind: "failed", reason: "disk full" });

    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });

  it("replaces the notice with a newer one", () => {
    const { result } = renderHook(() => useExportNotice());
    act(() => result.current.showNotice({ kind: "failed", reason: "disk full" }));
    act(() => result.current.showNotice({ kind: "insideWorkspace" }));
    expect(result.current.notice).toEqual({ kind: "insideWorkspace" });
  });

  it("drops the notice the user had seen once their next export starts", () => {
    const { result } = renderHook(() => useExportNotice());
    act(() => result.current.showNotice({ kind: "failed", reason: "disk full" }));
    const dropSeenNotice = result.current.captureSeenNotice();
    // Still up while the dialog is open: a cancelled dialog must leave it.
    expect(result.current.notice).not.toBeNull();

    act(() => dropSeenNotice());
    expect(result.current.notice).toBeNull();
  });

  it("keeps a notice another export raised while the dialog was open", () => {
    const { result } = renderHook(() => useExportNotice());
    const dropSeenNotice = result.current.captureSeenNotice();
    act(() => result.current.showNotice({ kind: "siteFailed", reason: "boom" }));

    act(() => dropSeenNotice());
    expect(result.current.notice).toEqual({ kind: "siteFailed", reason: "boom" });
  });

  it("keeps a notice that replaced the seen one, even one that reads the same", () => {
    const { result } = renderHook(() => useExportNotice());
    act(() => result.current.showNotice({ kind: "failed", reason: "disk full" }));
    const dropSeenNotice = result.current.captureSeenNotice();
    // A second export failing the same way is still news the user has not read.
    act(() => result.current.showNotice({ kind: "failed", reason: "disk full" }));

    act(() => dropSeenNotice());
    expect(result.current.notice).toEqual({ kind: "failed", reason: "disk full" });
  });

  it("leaves a later notice alone when the seen one was already dismissed", () => {
    const { result } = renderHook(() => useExportNotice());
    act(() => result.current.showNotice({ kind: "failed", reason: "disk full" }));
    const dropSeenNotice = result.current.captureSeenNotice();
    act(() => result.current.dismissNotice());
    act(() => result.current.showNotice({ kind: "pruneFailed", reason: "locked" }));

    act(() => dropSeenNotice());
    expect(result.current.notice).toEqual({ kind: "pruneFailed", reason: "locked" });
  });

  it("keeps its actions' identity while the notice changes", () => {
    const { result } = renderHook(() => useExportNotice());
    const { showNotice, captureSeenNotice, dismissNotice } = result.current;
    act(() => result.current.showNotice({ kind: "insideWorkspace" }));
    // The export handlers, and the menu subscription on them, depend on these.
    expect(result.current.showNotice).toBe(showNotice);
    expect(result.current.captureSeenNotice).toBe(captureSeenNotice);
    expect(result.current.dismissNotice).toBe(dismissNotice);
  });
});
