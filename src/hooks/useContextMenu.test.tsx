import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContextMenu } from "./useContextMenu";

const menuItems: Array<{ text?: string; action?: () => void }> = [];
let popupSpy: ReturnType<typeof vi.fn>;

vi.mock("@tauri-apps/api/menu", () => ({
  MenuItem: {
    new: vi.fn(async (opts: { text: string; action?: () => void }) => {
      menuItems.push(opts);
      return opts;
    }),
  },
  PredefinedMenuItem: {
    new: vi.fn(async (opts: { item: string }) => {
      menuItems.push({ text: opts.item });
      return opts;
    }),
  },
  Submenu: {
    new: vi.fn(async (opts: { text: string; items: unknown[] }) => {
      menuItems.push({ text: opts.text });
      return opts;
    }),
  },
  Menu: {
    new: vi.fn(async () => ({ popup: popupSpy })),
  },
}));

async function fireContextMenu() {
  document.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  menuItems.length = 0;
  popupSpy = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useContextMenu", () => {
  it("attaches no contextmenu listener on macOS (defers to native)", async () => {
    const actions = { openFileDialog: vi.fn(), toggleSidebar: vi.fn() };
    renderHook(() => useContextMenu("macos", actions));

    await fireContextMenu();

    expect(menuItems).toHaveLength(0);
    expect(popupSpy).not.toHaveBeenCalled();
  });

  it("attaches no contextmenu listener on unknown platforms", async () => {
    const actions = { openFileDialog: vi.fn(), toggleSidebar: vi.fn() };
    renderHook(() => useContextMenu("unknown", actions));

    await fireContextMenu();
    expect(menuItems).toHaveLength(0);
  });

  it("builds a default menu (Copy, SelectAll, Open File, Toggle Sidebar) on Linux", async () => {
    const actions = { openFileDialog: vi.fn(), toggleSidebar: vi.fn() };
    renderHook(() => useContextMenu("linux", actions));

    await fireContextMenu();

    const labels = menuItems.map((i) => i.text);
    expect(labels).toContain("Copy");
    expect(labels).toContain("SelectAll");
    expect(labels.some((l) => l?.includes("Open File"))).toBe(true);
    expect(labels).toContain("Toggle Sidebar");
    expect(popupSpy).toHaveBeenCalled();
  });

  it("adds the Read Aloud entry when TTS is available and there is content to read", async () => {
    const ttsSpeak = vi.fn();
    renderHook(() =>
      useContextMenu("linux", {
        openFileDialog: vi.fn(),
        toggleSidebar: vi.fn(),
        ttsAvailable: true,
        ttsSpeaking: false,
        ttsSpeak,
        content: "doc body",
      }),
    );

    await fireContextMenu();

    const readAloud = menuItems.find((i) => i.text === "Read Aloud");
    expect(readAloud).toBeDefined();
    readAloud?.action?.();
    expect(ttsSpeak).toHaveBeenCalledWith("doc body");
  });

  it("adds Stop Reading when TTS is currently speaking", async () => {
    const ttsStop = vi.fn();
    renderHook(() =>
      useContextMenu("linux", {
        openFileDialog: vi.fn(),
        toggleSidebar: vi.fn(),
        ttsAvailable: true,
        ttsSpeaking: true,
        ttsStop,
        content: "doc body",
      }),
    );

    await fireContextMenu();

    const stop = menuItems.find((i) => i.text === "Stop Reading");
    expect(stop).toBeDefined();
    stop?.action?.();
    expect(ttsStop).toHaveBeenCalled();
  });

  it("adds an AI submenu when an AI provider is configured and there's text", async () => {
    const aiAction = vi.fn();
    renderHook(() =>
      useContextMenu("linux", {
        openFileDialog: vi.fn(),
        toggleSidebar: vi.fn(),
        aiConfigured: true,
        aiAction,
        content: "doc body",
      }),
    );

    await fireContextMenu();

    const aiLabels = menuItems.filter((i) => i.text && /Document$/.test(i.text)).map((i) => i.text);
    expect(aiLabels).toEqual([
      "Summarize Document",
      "Explain Document",
      "Translate Document",
      "Simplify Document",
    ]);

    const summarize = menuItems.find((i) => i.text === "Summarize Document");
    summarize?.action?.();
    expect(aiAction).toHaveBeenCalledWith("summarize", "doc body");
  });

  it("Open File and Toggle Sidebar fire the provided actions when invoked", async () => {
    const openFileDialog = vi.fn();
    const toggleSidebar = vi.fn();
    renderHook(() => useContextMenu("linux", { openFileDialog, toggleSidebar }));

    await fireContextMenu();

    menuItems.find((i) => i.text?.startsWith("Open File"))?.action?.();
    menuItems.find((i) => i.text === "Toggle Sidebar")?.action?.();
    expect(openFileDialog).toHaveBeenCalled();
    expect(toggleSidebar).toHaveBeenCalled();
  });

  it("removes its listener on unmount", async () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() =>
      useContextMenu("linux", { openFileDialog: vi.fn(), toggleSidebar: vi.fn() }),
    );

    act(() => {
      unmount();
    });

    expect(removeSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
    removeSpy.mockRestore();
  });
});
