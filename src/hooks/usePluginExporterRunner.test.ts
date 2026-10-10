import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RunExporterOptions, runExporter } from "@/lib/plugins/runExporter";
import type { ExporterContribution } from "@/lib/plugins/types";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";
import { useWithExportNotice } from "@/test/exportNoticeHarness";
import { usePluginExporterRunner } from "./usePluginExporterRunner";

vi.mock("@/lib/plugins/runExporter", () => ({
  runExporter: vi.fn(),
}));

const exporter: ExporterContribution = {
  id: "x.slides",
  label: "Slides",
  extension: "html",
  build: async () => "out",
};

// What the pipeline does once the user has picked a destination.
async function exported({ onDestinationPicked }: RunExporterOptions) {
  onDestinationPicked?.();
}

function renderRunner(filePath?: string) {
  return renderHook(
    (props: { filePath?: string }) =>
      useWithExportNotice((actions) => ({
        run: usePluginExporterRunner({ filePath: props.filePath, content: "# A", ...actions }),
      })),
    { initialProps: { filePath } },
  );
}

beforeEach(() => {
  vi.mocked(runExporter).mockReset().mockImplementation(exported);
});

describe("usePluginExporterRunner", () => {
  it("runs the exporter with the bound document state", async () => {
    const { result } = renderRunner("/ws/a.md");

    act(() => result.current.run(exporter));

    await waitFor(() =>
      expect(vi.mocked(runExporter)).toHaveBeenCalledWith({
        exporter,
        filePath: "/ws/a.md",
        content: "# A",
        onDestinationPicked: expect.any(Function),
      }),
    );
    expect(result.current.notice).toBeNull();
  });

  it("reports a failed exporter with its reason, and logs it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runExporter).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderRunner();

    act(() => result.current.run(exporter));

    await waitFor(() => expect(result.current.notice).toEqual({ kind: "failed", reason: "boom" }));
    expect(spy).toHaveBeenCalledWith("Plugin exporter x.slides failed:", expect.any(Error));
    spy.mockRestore();
  });

  it("drops the previous notice once the next export has its destination", async () => {
    expectConsole(/Plugin exporter x\.slides failed/);
    vi.mocked(runExporter).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderRunner();
    act(() => result.current.run(exporter));
    await waitFor(() => expect(result.current.notice).not.toBeNull());

    act(() => result.current.run(exporter));
    await waitFor(() => expect(result.current.notice).toBeNull());
  });

  it("keeps an unread notice when the next save dialog is cancelled", async () => {
    expectConsole(/Plugin exporter x\.slides failed/);
    vi.mocked(runExporter).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderRunner();
    act(() => result.current.run(exporter));
    await waitFor(() => expect(result.current.notice).not.toBeNull());

    // A cancelled dialog resolves without a destination ever being picked.
    vi.mocked(runExporter).mockResolvedValueOnce(undefined);
    act(() => result.current.run(exporter));
    await waitFor(() => expect(runExporter).toHaveBeenCalledTimes(2));
    expect(result.current.notice).toEqual({ kind: "failed", reason: "boom" });
  });

  it("keeps a notice another export raised while the save dialog was open", async () => {
    const pick = deferred();
    vi.mocked(runExporter).mockImplementationOnce(async ({ onDestinationPicked }) => {
      await pick.promise;
      onDestinationPicked?.();
    });
    const { result } = renderRunner();
    act(() => result.current.run(exporter));
    act(() => result.current.showNotice({ kind: "siteFailed", reason: "locked" }));

    await act(async () => {
      pick.resolve();
      await vi.mocked(runExporter).mock.results[0].value;
    });
    expect(result.current.notice).toEqual({ kind: "siteFailed", reason: "locked" });
  });

  it("still reports an export whose document was switched away mid-run", async () => {
    expectConsole(/Plugin exporter x\.slides failed/);
    const build = deferred();
    vi.mocked(runExporter).mockReturnValueOnce(build.promise);
    const { result, rerender } = renderRunner("/ws/a.md");
    act(() => result.current.run(exporter));

    rerender({ filePath: "/ws/b.md" });
    await act(async () => {
      build.reject(new Error("boom"));
      await build.promise.catch(() => {});
    });
    // The user started it, so its outcome is still theirs to read.
    expect(result.current.notice).toEqual({ kind: "failed", reason: "boom" });
  });

  it("keeps its identity when a notice is raised", async () => {
    expectConsole(/Plugin exporter x\.slides failed/);
    vi.mocked(runExporter).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderRunner();
    const { run } = result.current;
    act(() => result.current.run(exporter));
    await waitFor(() => expect(result.current.notice).not.toBeNull());
    // The File > Export menu subscription is built on it.
    expect(result.current.run).toBe(run);
  });
});
