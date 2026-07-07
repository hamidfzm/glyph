import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { runExporter } from "@/lib/plugins/runExporter";
import type { ExporterContribution } from "@/lib/plugins/types";
import { usePluginExporterRunner } from "./usePluginExporterRunner";

vi.mock("@/lib/plugins/runExporter", () => ({
  runExporter: vi.fn(() => Promise.resolve()),
}));

const exporter: ExporterContribution = {
  id: "x.slides",
  label: "Slides",
  extension: "html",
  build: async () => "out",
};

describe("usePluginExporterRunner", () => {
  it("runs the exporter with the bound document state", async () => {
    const { result } = renderHook(() =>
      usePluginExporterRunner({ entries: [], filePath: "/ws/a.md", content: "# A" }),
    );

    result.current(exporter);

    await vi.waitFor(() =>
      expect(vi.mocked(runExporter)).toHaveBeenCalledWith({
        exporter,
        entries: [],
        filePath: "/ws/a.md",
        content: "# A",
      }),
    );
  });

  it("logs instead of throwing when the exporter fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runExporter).mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => usePluginExporterRunner({ entries: [], content: null }));
    result.current(exporter);

    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });
});
