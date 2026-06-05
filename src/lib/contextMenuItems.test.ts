import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildContextMenuItems,
  type ContextMenuItem,
  copySelection,
  searchGoogle,
  selectAllContent,
} from "./contextMenuItems";

function actionLabels(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) => (item.kind === "action" ? [item.label] : []));
}

function find(items: ContextMenuItem[], label: string) {
  return items.find((item) => item.kind === "action" && item.label === label);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("buildContextMenuItems", () => {
  it("without a selection offers Select All and Open File only", () => {
    const items = buildContextMenuItems({ openFileDialog: vi.fn() }, "");
    expect(actionLabels(items)).toEqual(["Select All", "Open File…"]);
    // A separator divides the two groups.
    expect(items.some((i) => i.kind === "separator")).toBe(true);
  });

  it("with a selection adds Copy and a truncated Search Google entry", () => {
    const selection = "x".repeat(50);
    const items = buildContextMenuItems({ openFileDialog: vi.fn() }, selection);
    const labels = actionLabels(items);
    expect(labels).toContain("Copy");
    const search = labels.find((l) => l.startsWith("Search Google"));
    expect(search).toBe(`Search Google for "${"x".repeat(30)}…"`);
  });

  it("adds Read Aloud when TTS is available with content, and Stop Reading while speaking", () => {
    const speak = vi.fn();
    const readItems = buildContextMenuItems(
      { openFileDialog: vi.fn(), ttsAvailable: true, ttsSpeak: speak, content: "doc body" },
      "",
    );
    const readAloud = find(readItems, "Read Aloud");
    expect(readAloud).toBeDefined();
    if (readAloud?.kind === "action") readAloud.onSelect();
    expect(speak).toHaveBeenCalledWith("doc body");

    const stop = vi.fn();
    const speakingItems = buildContextMenuItems(
      { openFileDialog: vi.fn(), ttsAvailable: true, ttsSpeaking: true, ttsStop: stop },
      "",
    );
    expect(find(speakingItems, "Stop Reading")).toBeDefined();
  });

  it("uses 'Read Selection Aloud' when text is selected", () => {
    const items = buildContextMenuItems(
      { openFileDialog: vi.fn(), ttsAvailable: true, ttsSpeak: vi.fn() },
      "hello",
    );
    expect(find(items, "Read Selection Aloud")).toBeDefined();
  });

  it("builds an AI submenu over the document when configured", () => {
    const aiAction = vi.fn();
    const items = buildContextMenuItems(
      { openFileDialog: vi.fn(), aiConfigured: true, aiAction, content: "doc body" },
      "",
    );
    const submenu = items.find((i) => i.kind === "submenu");
    expect(submenu?.kind === "submenu" && submenu.items.map((s) => s.label)).toEqual([
      "Summarize Document",
      "Explain Document",
      "Translate Document",
      "Simplify Document",
    ]);
    if (submenu?.kind === "submenu") {
      const summarize = submenu.items[0];
      if (summarize.kind === "action") summarize.onSelect();
    }
    expect(aiAction).toHaveBeenCalledWith("summarize", "doc body");
  });

  it("targets the selection in AI labels when text is selected", () => {
    const items = buildContextMenuItems(
      { openFileDialog: vi.fn(), aiConfigured: true, aiAction: vi.fn(), content: "doc" },
      "picked",
    );
    const submenu = items.find((i) => i.kind === "submenu");
    expect(submenu?.kind === "submenu" && submenu.items[0].label).toBe("Summarize Selection");
  });

  it("omits the AI submenu when there is no text to act on", () => {
    const items = buildContextMenuItems(
      { openFileDialog: vi.fn(), aiConfigured: true, aiAction: vi.fn(), content: "" },
      "",
    );
    expect(items.some((i) => i.kind === "submenu")).toBe(false);
  });

  it("Open File invokes the provided handler", () => {
    const openFileDialog = vi.fn();
    const items = buildContextMenuItems({ openFileDialog }, "");
    const open = find(items, "Open File…");
    if (open?.kind === "action") open.onSelect();
    expect(openFileDialog).toHaveBeenCalled();
  });

  it("Copy invokes the clipboard with the captured selection", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const items = buildContextMenuItems({ openFileDialog: vi.fn() }, "abc");
    const copy = find(items, "Copy");
    if (copy?.kind === "action") copy.onSelect();
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("Search Google opens the encoded query", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const items = buildContextMenuItems({ openFileDialog: vi.fn() }, "term");
    const search = items.find((i) => i.kind === "action" && i.label.startsWith("Search Google"));
    if (search?.kind === "action") search.onSelect();
    expect(open).toHaveBeenCalledWith("https://www.google.com/search?q=term", "_blank");
  });

  it("Stop Reading invokes ttsStop", () => {
    const ttsStop = vi.fn();
    const items = buildContextMenuItems(
      { openFileDialog: vi.fn(), ttsAvailable: true, ttsSpeaking: true, ttsStop },
      "",
    );
    const stop = find(items, "Stop Reading");
    if (stop?.kind === "action") stop.onSelect();
    expect(ttsStop).toHaveBeenCalled();
  });

  it("omits the read entry when TTS is available but there is no text to read", () => {
    const items = buildContextMenuItems(
      { openFileDialog: vi.fn(), ttsAvailable: true, ttsSpeak: vi.fn(), content: "" },
      "",
    );
    expect(find(items, "Read Aloud")).toBeUndefined();
    expect(find(items, "Read Selection Aloud")).toBeUndefined();
  });
});

describe("selectAllContent", () => {
  it("selects the rendered markdown body when present", () => {
    const body = document.createElement("div");
    body.className = "markdown-body";
    body.textContent = "hello world";
    document.body.appendChild(body);

    selectAllContent();
    expect(window.getSelection()?.rangeCount).toBe(1);
  });

  it("falls back to the document body when there is no markdown body", () => {
    document.body.textContent = "plain";
    selectAllContent();
    expect(window.getSelection()?.rangeCount).toBe(1);
  });

  it("does nothing when there is no selection object", () => {
    vi.spyOn(window, "getSelection").mockReturnValue(null);
    expect(() => selectAllContent()).not.toThrow();
  });
});

describe("clipboard and search helpers", () => {
  it("copySelection writes the captured text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    copySelection("captured");
    expect(writeText).toHaveBeenCalledWith("captured");
    vi.unstubAllGlobals();
  });

  it("copySelection swallows clipboard rejections", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(() => copySelection("captured")).not.toThrow();
    // Let the rejected promise settle so the catch runs.
    await Promise.resolve();
    vi.unstubAllGlobals();
  });

  it("searchGoogle opens an encoded query in a new tab", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    searchGoogle("a b & c");
    expect(open).toHaveBeenCalledWith("https://www.google.com/search?q=a%20b%20%26%20c", "_blank");
    vi.unstubAllGlobals();
  });
});
