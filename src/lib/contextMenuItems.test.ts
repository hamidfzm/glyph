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
  it("without a selection offers Select All only", () => {
    const items = buildContextMenuItems({}, "");
    expect(actionLabels(items)).toEqual(["Select All"]);
    expect(items.some((i) => i.kind === "separator")).toBe(false);
  });

  it("never includes an Open File entry", () => {
    const items = buildContextMenuItems({ ttsAvailable: true, ttsSpeak: vi.fn() }, "text");
    expect(actionLabels(items).some((l) => l.startsWith("Open File"))).toBe(false);
  });

  it("with a selection adds Copy and a truncated Search Google entry", () => {
    const selection = "x".repeat(50);
    const items = buildContextMenuItems({}, selection);
    const labels = actionLabels(items);
    expect(labels).toContain("Copy");
    const search = labels.find((l) => l.startsWith("Search Google"));
    expect(search).toBe(`Search Google for "${"x".repeat(30)}…"`);
  });

  it("adds Read Aloud when TTS is available with content, and Stop Reading while speaking", () => {
    const speak = vi.fn();
    const readItems = buildContextMenuItems(
      { ttsAvailable: true, ttsSpeak: speak, content: "doc body" },
      "",
    );
    const readAloud = find(readItems, "Read Aloud");
    expect(readAloud).toBeDefined();
    if (readAloud?.kind === "action") readAloud.onSelect();
    expect(speak).toHaveBeenCalledWith("doc body");

    const speakingItems = buildContextMenuItems(
      { ttsAvailable: true, ttsSpeaking: true, ttsStop: vi.fn() },
      "",
    );
    expect(find(speakingItems, "Stop Reading")).toBeDefined();
  });

  it("uses 'Read Selection Aloud' when text is selected", () => {
    const items = buildContextMenuItems({ ttsAvailable: true, ttsSpeak: vi.fn() }, "hello");
    expect(find(items, "Read Selection Aloud")).toBeDefined();
  });

  it("omits the read entry when TTS is available but there is no text to read", () => {
    const items = buildContextMenuItems({ ttsAvailable: true, ttsSpeak: vi.fn(), content: "" }, "");
    expect(find(items, "Read Aloud")).toBeUndefined();
    expect(find(items, "Read Selection Aloud")).toBeUndefined();
  });

  it("builds an AI submenu over the document when configured", () => {
    const aiAction = vi.fn();
    const items = buildContextMenuItems({ aiConfigured: true, aiAction, content: "doc body" }, "");
    const submenu = items.find((i) => i.kind === "submenu");
    expect(submenu?.kind === "submenu" && submenu.items.map((s) => s.label)).toEqual([
      "Summarize Document",
      "Explain Document",
      "Translate Document",
      "Simplify Document",
    ]);
    if (submenu?.kind === "submenu") submenu.items[0].onSelect();
    expect(aiAction).toHaveBeenCalledWith("summarize", "doc body");
  });

  it("targets the selection in AI labels when text is selected", () => {
    const items = buildContextMenuItems(
      { aiConfigured: true, aiAction: vi.fn(), content: "doc" },
      "picked",
    );
    const submenu = items.find((i) => i.kind === "submenu");
    expect(submenu?.kind === "submenu" && submenu.items[0].label).toBe("Summarize Selection");
  });

  it("omits the AI submenu when there is no text to act on", () => {
    const items = buildContextMenuItems({ aiConfigured: true, aiAction: vi.fn(), content: "" }, "");
    expect(items.some((i) => i.kind === "submenu")).toBe(false);
  });

  it("Copy invokes the clipboard with the captured selection", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const items = buildContextMenuItems({}, "abc");
    const copy = find(items, "Copy");
    if (copy?.kind === "action") copy.onSelect();
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("Search Google opens the encoded query", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const items = buildContextMenuItems({}, "term");
    const search = items.find((i) => i.kind === "action" && i.label.startsWith("Search Google"));
    if (search?.kind === "action") search.onSelect();
    expect(open).toHaveBeenCalledWith("https://www.google.com/search?q=term", "_blank");
  });

  it("Stop Reading invokes ttsStop", () => {
    const ttsStop = vi.fn();
    const items = buildContextMenuItems({ ttsAvailable: true, ttsSpeaking: true, ttsStop }, "");
    const stop = find(items, "Stop Reading");
    if (stop?.kind === "action") stop.onSelect();
    expect(ttsStop).toHaveBeenCalled();
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
  it("copySelection writes the captured text to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    copySelection("captured");
    expect(writeText).toHaveBeenCalledWith("captured");
  });

  it("copySelection swallows clipboard rejections", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(() => copySelection("captured")).not.toThrow();
    await Promise.resolve();
  });

  it("searchGoogle opens an encoded query in a new tab", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    searchGoogle("a b & c");
    expect(open).toHaveBeenCalledWith("https://www.google.com/search?q=a%20b%20%26%20c", "_blank");
  });
});
