import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliExportRequest } from "@/lib/cliExport";
import { runCliDocumentExport } from "./cliDocumentExport";

const exportDocumentMock = vi.fn();
vi.mock("@/lib/export/exportDocument", () => ({
  exportDocument: (...args: unknown[]) => exportDocumentMock(...args),
}));

const waitForRenderIdleMock = vi.fn(async () => ({ settled: true }));
vi.mock("@/lib/export/renderReady", () => ({
  waitForRenderIdle: () => waitForRenderIdleMock(),
}));

const REQUEST: CliExportRequest = {
  input: "/ws/getting-started.md",
  format: "pdf",
  output: "/out/getting-started.pdf",
};

function setBody(): void {
  const body = document.createElement("div");
  body.className = "markdown-body";
  body.innerHTML = "<h1>Getting Started</h1>";
  document.body.appendChild(body);
}

beforeEach(() => {
  exportDocumentMock.mockReset().mockResolvedValue(undefined);
  waitForRenderIdleMock.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("runCliDocumentExport", () => {
  it("exports through the shared document exporter and returns the path", async () => {
    setBody();
    const path = await runCliDocumentExport(REQUEST, {
      entries: [{ id: "intro", text: "Intro", level: 1 }],
      includeToc: true,
      content: "# Getting Started",
    });

    expect(path).toBe("/out/getting-started.pdf");
    expect(exportDocumentMock).toHaveBeenCalledWith(
      "pdf",
      "/out/getting-started.pdf",
      // Title comes from the document, base name from the input path.
      expect.objectContaining({ baseName: "getting-started", title: "Getting Started" }),
      { entries: [{ id: "intro", text: "Intro", level: 1 }], includeToc: true },
    );
  });

  it("waits for the render to settle before exporting", async () => {
    setBody();
    const order: string[] = [];
    waitForRenderIdleMock.mockImplementation(async () => {
      order.push("wait");
      return { settled: true };
    });
    exportDocumentMock.mockImplementation(async () => {
      order.push("export");
    });

    await runCliDocumentExport(REQUEST, { entries: [], includeToc: false, content: null });
    expect(order).toEqual(["wait", "export"]);
  });

  it("fails loudly when the document never rendered", async () => {
    // exportDocument silently no-ops without a body, which would otherwise
    // report success for an export that wrote nothing.
    await expect(
      runCliDocumentExport(REQUEST, { entries: [], includeToc: false, content: null }),
    ).rejects.toThrow("did not finish rendering");
    expect(exportDocumentMock).not.toHaveBeenCalled();
  });
});
