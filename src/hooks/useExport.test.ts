import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrintSettings } from "@/lib/settings";
import { useExport } from "./useExport";
import type { TocEntry } from "./useTableOfContents";

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

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(save).mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useExport", () => {
  it("does nothing when there is no rendered body", async () => {
    vi.mocked(save).mockResolvedValue("/out.html");
    const { result } = renderHook(() => useExport(options()));
    await result.current.exportHtml();
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes HTML via write_file with the source-derived filename", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.html");
    const { result } = renderHook(() => useExport(options()));
    await result.current.exportHtml();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "note.html" }));
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_file");
    expect(call).toBeTruthy();
    expect((call?.[1] as { content: string }).content).toContain('<div class="markdown-body">');
  });

  it("does not write when the save dialog is cancelled", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue(null);
    const { result } = renderHook(() => useExport(options()));
    await result.current.exportHtml();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes EPUB bytes via write_binary_file", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.epub");
    const { result } = renderHook(() => useExport(options()));
    await result.current.exportEpub();

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_binary_file");
    expect(call).toBeTruthy();
    expect((call?.[1] as { contents: Uint8Array }).contents).toBeInstanceOf(Uint8Array);
  });

  it("writes DOCX bytes via write_binary_file", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.docx");
    const { result } = renderHook(() => useExport(options()));
    await result.current.exportDocx();

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_binary_file");
    expect(call).toBeTruthy();
    expect((call?.[1] as { contents: Uint8Array }).contents.length).toBeGreaterThan(0);
  });

  it("logs and recovers when a write fails", async () => {
    setBody();
    vi.mocked(save).mockResolvedValue("/out.html");
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useExport(options()));
    await result.current.exportHtml();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
