import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { useAssetRef } from "./useAssetRef";

// convertFileSrc is mocked globally in src/test/setup.ts to
// `asset://localhost/<path>`. Mirrored paths are remembered for the whole
// file, so every test uses its own.

function inWorkspace({ children }: { children: ReactNode }) {
  const tabs = { workspace: { root: "/ws" } } as unknown as TabsContextValue;
  return <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>;
}

function deferInvoke() {
  let answer = () => {};
  const pending = new Promise<void>((resolve) => {
    answer = resolve;
  });
  vi.mocked(invoke).mockReturnValueOnce(pending);
  return () => answer();
}

describe("useAssetRef", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("holds a loose file's neighbour back until the backend has mirrored it", async () => {
    const answer = deferInvoke();
    const { result } = renderHook(() => useAssetRef("img/a.png", "/notes/doc.md"));

    expect(result.current.src).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("allow_document_asset", { path: "/notes/img/a.png" });

    await act(async () => answer());
    expect(result.current).toEqual({
      src: "asset://localhost//notes/img/a.png",
      path: "/notes/img/a.png",
    });
  });

  it("remembers a mirrored path, so the next element loads at once", async () => {
    const first = renderHook(() => useAssetRef("b.png", "/notes/doc.md"));
    await waitFor(() => expect(first.result.current.src).toBeDefined());
    vi.mocked(invoke).mockClear();

    const again = renderHook(() => useAssetRef("./b.png", "/notes/doc.md"));
    expect(again.result.current.src).toBe("asset://localhost//notes/b.png");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still renders a refused path, and asks again next time", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("path is outside the allowed workspaces and files");
    const first = renderHook(() => useAssetRef("../up.png", "/notes/doc.md"));
    await waitFor(() => expect(first.result.current.src).toBe("asset://localhost//up.png"));
    vi.mocked(invoke).mockClear();

    const second = renderHook(() => useAssetRef("../up.png", "/notes/doc.md"));
    expect(invoke).toHaveBeenCalledWith("allow_document_asset", { path: "/up.png" });
    await waitFor(() => expect(second.result.current.src).toBe("asset://localhost//up.png"));
  });

  it("keeps a replaced reference held back when the old answer lands", async () => {
    const answerOld = deferInvoke();
    const answerNew = deferInvoke();
    const { result, rerender } = renderHook(({ src }) => useAssetRef(src, "/notes/doc.md"), {
      initialProps: { src: "c.png" },
    });
    rerender({ src: "d.png" });

    await act(async () => answerOld());
    expect(result.current.src).toBeUndefined();

    await act(async () => answerNew());
    expect(result.current.src).toBe("asset://localhost//notes/d.png");
  });

  it("asks once for a path several elements wait on", async () => {
    const answer = deferInvoke();
    const first = renderHook(() => useAssetRef("e.png", "/notes/doc.md"));
    const second = renderHook(() => useAssetRef("./e.png", "/notes/doc.md"));
    expect(invoke).toHaveBeenCalledTimes(1);

    await act(async () => answer());
    expect(first.result.current.src).toBe("asset://localhost//notes/e.png");
    expect(second.result.current.src).toBe("asset://localhost//notes/e.png");
  });

  it("needs no round trip inside a workspace, whose folder the asset scope covers", () => {
    const { result } = renderHook(() => useAssetRef("img/f.png", "/ws/doc.md"), {
      wrapper: inWorkspace,
    });
    expect(result.current.src).toBe("asset://localhost//ws/img/f.png");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("treats a file opened from outside the workspace as loose", async () => {
    const { result } = renderHook(() => useAssetRef("g.png", "/elsewhere/doc.md"), {
      wrapper: inWorkspace,
    });
    expect(invoke).toHaveBeenCalledWith("allow_document_asset", { path: "/elsewhere/g.png" });
    await waitFor(() => expect(result.current.src).toBe("asset://localhost//elsewhere/g.png"));
  });

  it("passes a remote URL straight through", () => {
    const { result } = renderHook(() => useAssetRef("https://example.com/h.png", "/notes/doc.md"));
    expect(result.current.src).toBe("https://example.com/h.png");
    expect(invoke).not.toHaveBeenCalled();
  });
});
