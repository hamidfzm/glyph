import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrintSettings } from "@/lib/settings";
import { useExport } from "./useExport";
import type { TocEntry } from "./useTableOfContents";

// Canvas export sources are mocked so the tests control the produced output.
const buildBoardMock = vi.fn();
const buildDocumentMock = vi.fn();
const buildModelMock = vi.fn();
const buildCanvasPdfMock = vi.fn();
vi.mock("@/lib/canvas/exportDoc", () => ({
  buildCanvasBoardHtml: (...args: unknown[]) => buildBoardMock(...args),
  buildCanvasDocumentHtml: (...args: unknown[]) => buildDocumentMock(...args),
}));
vi.mock("@/lib/canvas/exportModel", () => ({
  buildCanvasBoardModel: (...args: unknown[]) => buildModelMock(...args),
}));
vi.mock("@/lib/export/canvasPdf", () => ({
  buildCanvasPdf: (...args: unknown[]) => buildCanvasPdfMock(...args),
}));

const PRINT: PrintSettings = {
  pageBreakLevel: "none",
  includeToc: false,
  includeBackground: false,
};
const ENTRIES: TocEntry[] = [{ id: "intro", text: "Intro", level: 1 }];

function options(over: Partial<Parameters<typeof useExport>[0]> = {}) {
  return {
    entries: ENTRIES,
    settings: PRINT,
    filePath: "/docs/note.md",
    content: "# Intro",
    ...over,
  };
}

function setBody(html = "<h1>Intro</h1>"): void {
  const body = document.createElement("div");
  body.className = "markdown-body";
  body.innerHTML = html;
  document.body.appendChild(body);
}

function setCanvas(): void {
  const board = document.createElement("div");
  board.className = "glyph-canvas";
  document.body.appendChild(board);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(save).mockReset();
  buildBoardMock.mockReset().mockResolvedValue('<div class="glyph-canvas-export">board</div>');
  buildDocumentMock.mockReset().mockResolvedValue("<section><h1>Card</h1></section>");
  buildModelMock
    .mockReset()
    .mockResolvedValue({ width: 10, height: 10, cards: [], edgesSvg: "<svg/>" });
  buildCanvasPdfMock.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useExport", () => {
  it("does nothing when there is no rendered body", async () => {
    vi.mocked(save).mockResolvedValue("/out.html");
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes HTML via write_file with the source-derived filename", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.html");
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportHtml();
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "note.html" }));
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_file");
    expect(call).toBeTruthy();
    expect((call?.[1] as { content: string }).content).toContain('<div class="markdown-body">');
  });

  it("does not write when the save dialog is cancelled", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue(null);
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes EPUB bytes via write_binary_file", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.epub");
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportEpub();
    });

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_binary_file");
    expect(call).toBeTruthy();
    // Bytes are sent as a plain number array so Rust's Vec<u8> can deserialize.
    const contents = (call?.[1] as { contents: number[] }).contents;
    expect(Array.isArray(contents)).toBe(true);
    expect(contents.length).toBeGreaterThan(0);
  });

  it("writes DOCX bytes via write_binary_file", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.docx");
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportDocx();
    });

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_binary_file");
    expect(call).toBeTruthy();
    expect((call?.[1] as { contents: Uint8Array }).contents.length).toBeGreaterThan(0);
  });

  it("writes PDF bytes via write_binary_file (no print dialog)", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.pdf");
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportPdf();
    });

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_binary_file");
    expect(call).toBeTruthy();
    expect((call?.[1] as { contents: Uint8Array }).contents.length).toBeGreaterThan(0);
    // It must not fall back to the print path.
    expect(vi.mocked(invoke).mock.calls.some((c) => c[0] === "print_document")).toBe(false);
  });

  it("aborts without writing if the document is closed during the save dialog", async () => {
    setBody();
    // The file is closed (body removed) while the native dialog is open.
    vi.mocked(save).mockImplementation(async () => {
      document.body.innerHTML = "";
      return "/out.html";
    });
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(save).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("logs and recovers when a write fails", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.html");
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("exports a canvas tab as a spatial vector HTML page", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue("/out.html");
    const { result } = renderHook(() => useExport(options({ filePath: "/docs/board.canvas" })));
    await act(async () => {
      await result.current.exportHtml();
    });

    expect(save).toHaveBeenCalledWith({
      defaultPath: "board.html",
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    expect(buildBoardMock).toHaveBeenCalled();
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_file");
    expect(call).toBeTruthy();
    const content = (call?.[1] as { content: string }).content;
    expect(content).toContain("glyph-canvas-export");
    expect(content).toContain('class="glyph-canvas-page"');
  });

  it("exports a canvas tab to PDF as the spatial vector board", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue("/out.pdf");
    const { result } = renderHook(() => useExport(options({ filePath: "/docs/board.canvas" })));
    await act(async () => {
      await result.current.exportPdf();
    });

    expect(save).toHaveBeenCalledWith({
      defaultPath: "board.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    expect(buildModelMock).toHaveBeenCalled();
    expect(buildCanvasPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ edgesSvg: "<svg/>" }),
      expect.objectContaining({ title: expect.any(String) }),
    );
    // The linearised document path belongs to DOCX/EPUB, not PDF.
    expect(buildDocumentMock).not.toHaveBeenCalled();
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_binary_file");
    expect(call).toBeTruthy();
    expect((call?.[1] as { contents: number[] }).contents).toEqual([1, 2, 3]);
  });

  it("skips the PDF write when the board model is empty", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue("/out.pdf");
    buildModelMock.mockResolvedValue(null);
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.exporting).toBeNull();
  });

  it("exports a canvas tab to EPUB and DOCX from the linearised document", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue("/out.epub");
    const { result } = renderHook(() => useExport(options({ filePath: "/docs/board.canvas" })));
    await act(async () => {
      await result.current.exportEpub();
    });
    expect(vi.mocked(invoke).mock.calls.filter((c) => c[0] === "write_binary_file")).toHaveLength(
      1,
    );

    vi.mocked(invoke).mockClear();
    vi.mocked(save).mockResolvedValue("/out.docx");
    await act(async () => {
      await result.current.exportDocx();
    });
    expect(vi.mocked(invoke).mock.calls.filter((c) => c[0] === "write_binary_file")).toHaveLength(
      1,
    );
  });

  it("does not write when the canvas save dialog is cancelled", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue(null);
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(buildDocumentMock).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("skips the write when the board yields no exportable content", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue("/out.html");
    buildBoardMock.mockResolvedValue(null);
    buildDocumentMock.mockResolvedValue(null);
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportHtml();
    });
    await act(async () => {
      await result.current.exportEpub();
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.exporting).toBeNull();
  });

  it("logs and recovers when the canvas export fails", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue("/out.html");
    buildBoardMock.mockRejectedValue(new Error("render failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useExport(options()));
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(spy).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.exporting).toBeNull();
    spy.mockRestore();
  });

  it("flags the chosen format while a canvas write is in flight", async () => {
    setCanvas();
    vi.mocked(save).mockResolvedValue("/out.html");
    let finishWrite!: () => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = () => resolve();
      }),
    );

    const { result } = renderHook(() => useExport(options()));
    expect(result.current.exporting).toBeNull();

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.exportHtml();
    });
    expect(result.current.exporting).toBe("html");

    await act(async () => {
      finishWrite();
      await pending;
    });
    expect(result.current.exporting).toBeNull();
  });

  it("flags the active format while writing and clears it when done", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.html");
    let finishWrite!: () => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = () => resolve();
      }),
    );

    const { result } = renderHook(() => useExport(options()));
    expect(result.current.exporting).toBeNull();

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.exportHtml();
    });
    // After the (mocked) dialog and content prep, the write is in flight.
    expect(result.current.exporting).toBe("html");

    await act(async () => {
      finishWrite();
      await pending;
    });
    expect(result.current.exporting).toBeNull();
  });
});
