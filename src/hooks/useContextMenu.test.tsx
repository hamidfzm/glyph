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

async function fireContextMenu(target: EventTarget = document) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return event;
}

function mountMarkdown() {
  const root = document.createElement("div");
  root.className = "markdown-body";
  const para = document.createElement("p");
  para.textContent = "doc body";
  root.appendChild(para);
  document.body.appendChild(root);
  return { root, para };
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
    const actions = { openFileDialog: vi.fn() };
    renderHook(() => useContextMenu("macos", actions));

    await fireContextMenu();

    expect(menuItems).toHaveLength(0);
    expect(popupSpy).not.toHaveBeenCalled();
  });

  it("attaches no contextmenu listener on unknown platforms", async () => {
    const actions = { openFileDialog: vi.fn() };
    renderHook(() => useContextMenu("unknown", actions));

    await fireContextMenu();
    expect(menuItems).toHaveLength(0);
  });

  it("builds a default menu (Copy, SelectAll, Open File) on Linux", async () => {
    const actions = { openFileDialog: vi.fn() };
    renderHook(() => useContextMenu("linux", actions));
    const { para, root } = mountMarkdown();

    await fireContextMenu(para);

    const labels = menuItems.map((i) => i.text);
    expect(labels).toContain("Copy");
    expect(labels).toContain("SelectAll");
    expect(labels.some((l) => l?.includes("Open File"))).toBe(true);
    expect(labels).not.toContain("Toggle Sidebar");
    expect(popupSpy).toHaveBeenCalled();
    document.body.removeChild(root);
  });

  it("adds the Read Aloud entry when TTS is available and there is content to read", async () => {
    const ttsSpeak = vi.fn();
    renderHook(() =>
      useContextMenu("linux", {
        openFileDialog: vi.fn(),
        ttsAvailable: true,
        ttsSpeaking: false,
        ttsSpeak,
        content: "doc body",
      }),
    );
    const { para, root } = mountMarkdown();

    await fireContextMenu(para);

    const readAloud = menuItems.find((i) => i.text === "Read Aloud");
    expect(readAloud).toBeDefined();
    readAloud?.action?.();
    expect(ttsSpeak).toHaveBeenCalledWith("doc body");
    document.body.removeChild(root);
  });

  it("adds Stop Reading when TTS is currently speaking", async () => {
    const ttsStop = vi.fn();
    renderHook(() =>
      useContextMenu("linux", {
        openFileDialog: vi.fn(),
        ttsAvailable: true,
        ttsSpeaking: true,
        ttsStop,
        content: "doc body",
      }),
    );
    const { para, root } = mountMarkdown();

    await fireContextMenu(para);

    const stop = menuItems.find((i) => i.text === "Stop Reading");
    expect(stop).toBeDefined();
    stop?.action?.();
    expect(ttsStop).toHaveBeenCalled();
    document.body.removeChild(root);
  });

  it("adds an AI submenu when an AI provider is configured and there's text", async () => {
    const aiAction = vi.fn();
    renderHook(() =>
      useContextMenu("linux", {
        openFileDialog: vi.fn(),
        aiConfigured: true,
        aiAction,
        content: "doc body",
      }),
    );
    const { para, root } = mountMarkdown();

    await fireContextMenu(para);

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
    document.body.removeChild(root);
  });

  it("Open File fires the provided action when invoked", async () => {
    const openFileDialog = vi.fn();
    renderHook(() => useContextMenu("linux", { openFileDialog }));
    const { para, root } = mountMarkdown();

    await fireContextMenu(para);

    menuItems.find((i) => i.text?.startsWith("Open File"))?.action?.();
    expect(openFileDialog).toHaveBeenCalled();
    document.body.removeChild(root);
  });

  it("leaves the native menu alone for UI chrome (outside markdown-body)", async () => {
    renderHook(() => useContextMenu("linux", { openFileDialog: vi.fn() }));
    const chrome = document.createElement("div");
    chrome.textContent = "Modal label";
    document.body.appendChild(chrome);

    const event = await fireContextMenu(chrome);

    expect(event.defaultPrevented).toBe(false);
    expect(menuItems).toHaveLength(0);
    expect(popupSpy).not.toHaveBeenCalled();
    document.body.removeChild(chrome);
  });

  it("leaves the native menu alone when contextmenu fires inside an input", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    renderHook(() => useContextMenu("linux", { openFileDialog: vi.fn() }));

    const event = await fireContextMenu(input);

    expect(event.defaultPrevented).toBe(false);
    expect(menuItems).toHaveLength(0);
    expect(popupSpy).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("leaves the native menu alone for textarea and contenteditable too", async () => {
    const textarea = document.createElement("textarea");
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    document.body.appendChild(textarea);
    document.body.appendChild(ce);
    renderHook(() => useContextMenu("linux", { openFileDialog: vi.fn() }));

    const fromTextarea = await fireContextMenu(textarea);
    const fromContentEditable = await fireContextMenu(ce);

    expect(fromTextarea.defaultPrevented).toBe(false);
    expect(fromContentEditable.defaultPrevented).toBe(false);
    expect(menuItems).toHaveLength(0);
    document.body.removeChild(textarea);
    document.body.removeChild(ce);
  });

  it("removes its listener on unmount", async () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useContextMenu("linux", { openFileDialog: vi.fn() }));

    act(() => {
      unmount();
    });

    expect(removeSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
    removeSpy.mockRestore();
  });
});
