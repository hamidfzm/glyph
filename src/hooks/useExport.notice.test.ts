import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickSave } from "@/lib/pickers";
import type { PrintSettings } from "@/lib/settings";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";
import { useWithExportNotice } from "@/test/exportNoticeHarness";
import { mountDocumentBody } from "@/test/mountDocumentBody";
import { useExport } from "./useExport";
import type { TocEntry } from "./useTableOfContents";

vi.mock("@/lib/pickers", () => ({
  pickSave: vi.fn(),
}));

const PRINT: PrintSettings = {
  pageBreakLevel: "none",
  includeToc: false,
  includeBackground: false,
  epubMediaLimit: "10" as const,
};

// One array for every render: the handlers are rebuilt when the entries change.
const ENTRIES: TocEntry[] = [];

function renderExport(filePath = "/docs/note.md") {
  return renderHook(
    (props: { filePath: string }) =>
      useWithExportNotice((actions) =>
        useExport({
          entries: ENTRIES,
          settings: PRINT,
          filePath: props.filePath,
          content: "# Intro",
          ...actions,
        }),
      ),
    { initialProps: { filePath } },
  );
}

const DISK_FULL = { kind: "failed", reason: "disk full" };

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(pickSave).mockReset().mockResolvedValue("/out.html");
  mountDocumentBody("<h1>Intro</h1>");
  expectConsole(/Failed to export/);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useExport notice", () => {
  it("reports the plain string a rejected command throws", async () => {
    vi.mocked(invoke).mockRejectedValue("Failed to write file: Access is denied. (os error 5)");
    const { result } = renderExport();
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(result.current.notice).toEqual({
      kind: "failed",
      reason: "Failed to write file: Access is denied. (os error 5)",
    });
  });

  it("reports a save dialog that could not open instead of failing silently", async () => {
    vi.mocked(pickSave).mockRejectedValue("dialog unavailable");
    const { result } = renderExport();
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(result.current.notice).toEqual({ kind: "failed", reason: "dialog unavailable" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps an unread notice when the next save dialog is cancelled", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderExport();
    await act(async () => {
      await result.current.exportHtml();
    });

    // A cancelled dialog is not a new export: the notice has not been acted on.
    vi.mocked(pickSave).mockResolvedValue(null);
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(result.current.notice).toEqual(DISK_FULL);
  });

  it("keeps an unread notice when the document was closed during the next dialog", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderExport();
    await act(async () => {
      await result.current.exportHtml();
    });

    // Nothing gets exported, so the retry has not made the failure old news.
    vi.mocked(pickSave).mockImplementation(async () => {
      document.body.innerHTML = "";
      return "/out.html";
    });
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(result.current.notice).toEqual(DISK_FULL);
  });

  it("drops the previous notice once the next export starts writing", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderExport();
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(result.current.notice).not.toBeNull();

    const write = deferred();
    vi.mocked(invoke).mockReturnValue(write.promise);
    let retry!: Promise<void>;
    await act(async () => {
      retry = result.current.exportHtml();
    });
    // Gone while the retry runs, not only once it ends.
    expect(result.current.exporting).toBe("html");
    expect(result.current.notice).toBeNull();

    await act(async () => {
      write.resolve();
      await retry;
    });
    expect(result.current.notice).toBeNull();
  });

  it("keeps the failure of an export that ended behind the next one's save dialog", async () => {
    const firstWrite = deferred();
    const secondPick = deferred<string | null>();
    vi.mocked(pickSave)
      .mockResolvedValueOnce("/first.html")
      .mockReturnValueOnce(secondPick.promise);
    vi.mocked(invoke).mockReturnValueOnce(firstWrite.promise);
    const { result } = renderExport();

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.exportHtml();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      second = result.current.exportHtml();
      await vi.waitFor(() => expect(pickSave).toHaveBeenCalledTimes(2));
    });

    await act(async () => {
      firstWrite.reject(new Error("disk full"));
      await first;
    });
    // Confirming the second dialog must not clear a failure it never showed.
    await act(async () => {
      secondPick.resolve("/second.html");
      await second;
    });
    expect(result.current.notice).toEqual(DISK_FULL);
  });

  it("still reports an export whose tab was switched away mid-write", async () => {
    const write = deferred();
    vi.mocked(invoke).mockReturnValueOnce(write.promise);
    const { result, rerender } = renderExport("/docs/note.md");
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.exportHtml();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    });

    rerender({ filePath: "/docs/other.md" });
    await act(async () => {
      write.reject(new Error("disk full"));
      await pending;
    });
    // The user started it, so its outcome is still theirs to read.
    expect(result.current.notice).toEqual(DISK_FULL);
  });

  it("fails quietly when the shell is gone before the write ends", async () => {
    const write = deferred();
    vi.mocked(invoke).mockReturnValueOnce(write.promise);
    const { result, unmount } = renderExport();
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.exportHtml();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    });

    unmount();
    write.reject(new Error("disk full"));
    // Only the declared log line: no throw, no update-after-unmount warning.
    await expect(pending).resolves.toBeUndefined();
  });

  it("keeps its handlers' identity when a notice is raised", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    const { result } = renderExport();
    const { exportHtml } = result.current;
    await act(async () => {
      await result.current.exportHtml();
    });
    // The menu subscription is built on the handlers; a failure must not rebuild it.
    expect(result.current.notice).not.toBeNull();
    expect(result.current.exportHtml).toBe(exportHtml);
  });
});
