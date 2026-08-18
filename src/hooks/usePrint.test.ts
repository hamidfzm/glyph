import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrintSettings } from "@/lib/settings";
import { usePrint } from "./usePrint";
import type { TocEntry } from "./useTableOfContents";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const restoreDiagramsMock = vi.fn();
const swapDiagramsLightMock = vi.fn(async () => restoreDiagramsMock);
// The factory can be told to fail so the chunk-load error path is testable.
let lightDiagramsLoadError: Error | null = null;
vi.mock("@/lib/export/lightDiagrams", () => {
  if (lightDiagramsLoadError) throw lightDiagramsLoadError;
  return { swapDiagramsLight: () => swapDiagramsLightMock() };
});

const DEFAULT_PRINT: PrintSettings = {
  pageBreakLevel: "none",
  includeToc: false,
  includeBackground: false,
  epubMediaLimit: "10",
};

const ENTRIES: TocEntry[] = [
  { id: "intro", text: "Intro", level: 1 },
  { id: "details", text: "Details", level: 2 },
];

describe("usePrint", () => {
  beforeEach(() => {
    const body = document.createElement("div");
    body.className = "markdown-body";
    document.body.appendChild(body);
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-print-breaks");
    document.documentElement.removeAttribute("data-print-bg");
    document.documentElement.classList.remove("dark");
    document.body.innerHTML = "";
    swapDiagramsLightMock.mockClear();
    restoreDiagramsMock.mockClear();
  });

  // First in the file: the mock factory only throws on its first evaluation
  // (a failed factory is not cached, so later tests re-evaluate it clean),
  // which only lines up while no other test has imported the module yet.
  it("aborts printing with a log when the helper chunk fails to load", async () => {
    lightDiagramsLoadError = new Error("chunk load failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => usePrint({ entries: ENTRIES, settings: DEFAULT_PRINT }));
      await result.current();
      expect(errorSpy).toHaveBeenCalledWith("Print helpers failed to load:", expect.any(Error));
      expect(invokeMock).not.toHaveBeenCalled();
      expect(document.documentElement.hasAttribute("data-print-breaks")).toBe(false);
    } finally {
      lightDiagramsLoadError = null;
      errorSpy.mockRestore();
    }
  });

  it("no-ops when no .markdown-body is present", async () => {
    document.body.innerHTML = "";
    const { result } = renderHook(() => usePrint({ entries: ENTRIES, settings: DEFAULT_PRINT }));
    await result.current();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("no-ops when the only markdown body belongs to a canvas card", async () => {
    document.body.innerHTML = "";
    const board = document.createElement("div");
    board.className = "glyph-canvas";
    const card = document.createElement("div");
    card.className = "markdown-body";
    board.appendChild(card);
    document.body.appendChild(board);

    const { result } = renderHook(() => usePrint({ entries: ENTRIES, settings: DEFAULT_PRINT }));
    await result.current();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute("data-print-breaks")).toBe(false);
  });

  it("sets html data attributes from settings before printing", async () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: ENTRIES,
        settings: { ...DEFAULT_PRINT, pageBreakLevel: "h2", includeBackground: true },
      }),
    );
    await result.current();
    expect(document.documentElement.getAttribute("data-print-breaks")).toBe("h2");
    expect(document.documentElement.getAttribute("data-print-bg")).toBe("true");
    expect(invokeMock).toHaveBeenCalledWith("print_document");
  });

  it("injects a print-toc when includeToc is true and entries exist", async () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: ENTRIES,
        settings: { ...DEFAULT_PRINT, includeToc: true },
      }),
    );
    await result.current();
    const toc = document.querySelector(".print-toc");
    expect(toc).toBeTruthy();
    const links = toc?.querySelectorAll("a") ?? [];
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("#intro");
    expect(links[1].textContent).toBe("Details");
  });

  it("does not inject a print-toc when includeToc is true but entries are empty", async () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: [],
        settings: { ...DEFAULT_PRINT, includeToc: true },
      }),
    );
    await result.current();
    expect(document.querySelector(".print-toc")).toBeNull();
  });

  it("falls back to window.print when the native print command fails", async () => {
    invokeMock.mockRejectedValue(new Error("not available"));
    const printSpy = vi.fn();
    window.print = printSpy;

    const { result } = renderHook(() => usePrint({ entries: ENTRIES, settings: DEFAULT_PRINT }));
    await result.current();

    await vi.waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it("re-renders diagrams light in dark mode and restores them on afterprint", async () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => usePrint({ entries: ENTRIES, settings: DEFAULT_PRINT }));
    await result.current();

    expect(swapDiagramsLightMock).toHaveBeenCalledTimes(1);
    expect(restoreDiagramsMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("afterprint"));
    expect(restoreDiagramsMock).toHaveBeenCalledTimes(1);
  });

  it("leaves diagrams alone in light mode", async () => {
    const { result } = renderHook(() => usePrint({ entries: ENTRIES, settings: DEFAULT_PRINT }));
    await result.current();
    expect(swapDiagramsLightMock).not.toHaveBeenCalled();
  });

  it("cleans up attributes and toc on afterprint", async () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: ENTRIES,
        settings: { ...DEFAULT_PRINT, pageBreakLevel: "h1", includeToc: true },
      }),
    );
    await result.current();
    expect(document.querySelector(".print-toc")).toBeTruthy();

    window.dispatchEvent(new Event("afterprint"));

    expect(document.documentElement.hasAttribute("data-print-breaks")).toBe(false);
    expect(document.documentElement.hasAttribute("data-print-bg")).toBe(false);
    expect(document.querySelector(".print-toc")).toBeNull();
  });
});
