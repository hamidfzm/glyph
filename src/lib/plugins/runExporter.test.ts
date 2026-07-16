import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickSave } from "@/lib/pickers";
import { runExporter } from "./runExporter";

vi.mock("@/lib/pickers", () => ({
  pickSave: vi.fn(),
}));

import type { ExporterContribution } from "./types";

function exporter(over: Partial<ExporterContribution> = {}): ExporterContribution {
  return {
    id: "x.slides",
    label: "Slides",
    extension: "html",
    build: async (html) => `<deck>${html}</deck>`,
    ...over,
  };
}

function setBody() {
  document.body.innerHTML = '<div class="markdown-body"><h1>Doc</h1></div>';
}

describe("runExporter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(pickSave).mockReset();
  });

  it("does nothing when no document is rendered", async () => {
    vi.mocked(pickSave).mockResolvedValue("/out.html");
    await runExporter({ exporter: exporter(), entries: [], content: null });
    expect(pickSave).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    setBody();
    vi.mocked(pickSave).mockResolvedValue(null);
    await runExporter({ exporter: exporter(), entries: [], content: null });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes string output via write_file with the derived filename", async () => {
    setBody();
    vi.mocked(pickSave).mockResolvedValue("/out.html");
    await runExporter({
      exporter: exporter(),
      entries: [],
      filePath: "/ws/note.md",
      content: "# Doc",
    });

    expect(pickSave).toHaveBeenCalledWith(expect.stringMatching(/note\.html$/), "Slides", ["html"]);
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_file");
    expect(call?.[1]).toMatchObject({ path: "/out.html" });
    expect((call![1] as { content: string }).content).toContain("<deck>");
  });

  it("writes binary output via write_binary_file", async () => {
    setBody();
    vi.mocked(pickSave).mockResolvedValue("/out.bin");
    await runExporter({
      exporter: exporter({ extension: "bin", build: async () => new Uint8Array([1, 2, 3]) }),
      entries: [],
      content: null,
    });

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "write_binary_file");
    expect(call?.[1]).toMatchObject({ path: "/out.bin", contents: [1, 2, 3] });
  });
});
