import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrintSettings } from "../lib/settings";
import { usePrint } from "./usePrint";
import type { TocEntry } from "./useTableOfContents";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const DEFAULT_PRINT: PrintSettings = {
  pageBreakLevel: "none",
  includeToc: false,
  includeBackground: false,
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
    document.body.innerHTML = "";
  });

  it("no-ops when no .markdown-body is present", () => {
    document.body.innerHTML = "";
    const { result } = renderHook(() => usePrint({ entries: ENTRIES, settings: DEFAULT_PRINT }));
    result.current();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("sets html data attributes from settings before printing", () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: ENTRIES,
        settings: { pageBreakLevel: "h2", includeToc: false, includeBackground: true },
      }),
    );
    result.current();
    expect(document.documentElement.getAttribute("data-print-breaks")).toBe("h2");
    expect(document.documentElement.getAttribute("data-print-bg")).toBe("true");
    expect(invokeMock).toHaveBeenCalledWith("print_document");
  });

  it("injects a print-toc when includeToc is true and entries exist", () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: ENTRIES,
        settings: { ...DEFAULT_PRINT, includeToc: true },
      }),
    );
    result.current();
    const toc = document.querySelector(".print-toc");
    expect(toc).toBeTruthy();
    const links = toc?.querySelectorAll("a") ?? [];
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("#intro");
    expect(links[1].textContent).toBe("Details");
  });

  it("does not inject a print-toc when includeToc is true but entries are empty", () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: [],
        settings: { ...DEFAULT_PRINT, includeToc: true },
      }),
    );
    result.current();
    expect(document.querySelector(".print-toc")).toBeNull();
  });

  it("cleans up attributes and toc on afterprint", () => {
    const { result } = renderHook(() =>
      usePrint({
        entries: ENTRIES,
        settings: { pageBreakLevel: "h1", includeToc: true, includeBackground: false },
      }),
    );
    result.current();
    expect(document.querySelector(".print-toc")).toBeTruthy();

    window.dispatchEvent(new Event("afterprint"));

    expect(document.documentElement.hasAttribute("data-print-breaks")).toBe(false);
    expect(document.documentElement.hasAttribute("data-print-bg")).toBe(false);
    expect(document.querySelector(".print-toc")).toBeNull();
  });
});
