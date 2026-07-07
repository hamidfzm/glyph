import { describe, expect, it, vi } from "vitest";
import { FakeWorker } from "@/test/fakeWorker";
import { PLUGIN_API_VERSION } from "../apiVersion";
import type { ExporterContribution, InstalledPlugin } from "../types";
import type { SandboxHostApi } from "./sandbox";
import { startSandbox } from "./sandbox";

const plugin: InstalledPlugin = {
  id: "com.x.boxed",
  name: "Boxed",
  version: "1.0.0",
  apiVersion: `^${PLUGIN_API_VERSION}`,
  permissions: ["network:example.com"],
  sandbox: true,
  dir: "/plugins/com.x.boxed",
  mainSource: "export default { activate(){} };",
};

function apiStub(): SandboxHostApi {
  return {
    registerCommand: vi.fn(),
    addStyles: vi.fn(),
    registerExporter: vi.fn(),
    notify: vi.fn(),
    registerTranslations: vi.fn(),
    settingsSet: vi.fn(),
    workspaceRead: vi.fn().mockResolvedValue("file text"),
    workspaceList: vi.fn().mockResolvedValue(["/ws/a.md"]),
  };
}

function start(api = apiStub()) {
  const worker = new FakeWorker();
  const promise = startSandbox(plugin, { theme: "dark" }, api, () => worker);
  return { worker, api, promise };
}

async function startActivated(api = apiStub()) {
  const { worker, promise } = start(api);
  worker.emit({ type: "activated" });
  return { worker, api, dispose: await promise };
}

describe("startSandbox", () => {
  it("spawns a real Worker from a blob URL when no spawner is injected", async () => {
    const worker = new FakeWorker();
    const createObjectURL = vi.fn(() => "blob:bootstrap");
    // jsdom has neither Worker nor URL.createObjectURL; stub both.
    // A function expression so `new Worker(...)` can construct it.
    const workerCtor = vi.fn(function fakeWorkerCtor() {
      return worker;
    });
    vi.stubGlobal("Worker", workerCtor);
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = createObjectURL;
    try {
      const promise = startSandbox(plugin, {}, apiStub());
      worker.emit({ type: "activated" });
      await promise;
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(workerCtor).toHaveBeenCalledWith("blob:bootstrap");
      expect(worker.posted[0]).toMatchObject({ type: "init" });
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      vi.unstubAllGlobals();
    }
  });

  it("sends init with source, permissions, and settings, then resolves on activated", async () => {
    const { worker } = await startActivated();
    expect(worker.posted[0]).toEqual({
      type: "init",
      source: plugin.mainSource,
      apiVersion: PLUGIN_API_VERSION,
      permissions: ["network:example.com"],
      settings: { theme: "dark" },
    });
  });

  it("rejects and terminates on an activation error", async () => {
    const { worker, promise } = start();
    worker.emit({ type: "error", message: "boom" });
    await expect(promise).rejects.toThrow("boom");
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates when the worker itself fails", async () => {
    const { worker, promise } = start();
    worker.onerror?.("script error");
    await expect(promise).rejects.toThrow("sandbox worker failed");
    expect(worker.terminated).toBe(true);
  });

  it("logs errors after activation instead of rejecting", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { worker } = await startActivated();
    worker.emit({ type: "error", message: "later" });
    expect(consoleError).toHaveBeenCalledWith("Sandboxed plugin com.x.boxed error:", "later");
    consoleError.mockRestore();
  });

  it("the disposer terminates the worker", async () => {
    const { worker, dispose } = await startActivated();
    dispose();
    expect(worker.terminated).toBe(true);
  });

  it("bridges register-command; running it posts run-command", async () => {
    const { worker, api } = await startActivated();
    worker.emit({ type: "register-command", id: "c1", title: "Do it" });
    const [command] = vi.mocked(api.registerCommand).mock.calls[0];
    expect(command.title).toBe("Do it");
    command.run();
    expect(worker.posted).toContainEqual({ type: "run-command", id: "c1" });
  });

  it("bridges styles, notify, translations, and settings-set", async () => {
    const { worker, api } = await startActivated();
    worker.emit({ type: "add-styles", css: "body{color:red}" });
    worker.emit({ type: "notify", message: "hi" });
    worker.emit({
      type: "register-translations",
      locale: "de",
      namespace: "ns",
      resources: { k: "v" },
    });
    worker.emit({ type: "settings-set", key: "a", value: 1 });
    expect(api.addStyles).toHaveBeenCalledWith("body{color:red}");
    expect(api.notify).toHaveBeenCalledWith("hi");
    expect(api.registerTranslations).toHaveBeenCalledWith("de", "ns", { k: "v" });
    expect(api.settingsSet).toHaveBeenCalledWith("a", 1);
  });

  it("round-trips an exporter build through the worker", async () => {
    const { worker, api } = await startActivated();
    worker.emit({ type: "register-exporter", id: "e1", label: "Text", extension: "txt" });
    const [exporter] = vi.mocked(api.registerExporter).mock.calls[0] as [ExporterContribution];

    const building = exporter.build("<p>hi</p>");
    const request = worker.posted.find((m) => m.type === "build-export");
    expect(request).toMatchObject({ id: "e1", bodyHtml: "<p>hi</p>" });
    const callId = (request as { callId: number }).callId;

    worker.emit({ type: "export-result", callId, ok: true, output: "done" });
    await expect(building).resolves.toBe("done");
  });

  it("delivers byte-array export output as Uint8Array and rejects failures", async () => {
    const { worker, api } = await startActivated();
    worker.emit({ type: "register-exporter", id: "e1", label: "Bin", extension: "bin" });
    const [exporter] = vi.mocked(api.registerExporter).mock.calls[0] as [ExporterContribution];

    const first = exporter.build("a");
    worker.emit({ type: "export-result", callId: 1, ok: true, output: [1, 2] });
    await expect(first).resolves.toEqual(new Uint8Array([1, 2]));

    const second = exporter.build("b");
    worker.emit({ type: "export-result", callId: 2, ok: false, error: "no bytes" });
    await expect(second).rejects.toThrow("no bytes");

    // Unknown callId is ignored rather than crashing the bridge.
    worker.emit({ type: "export-result", callId: 99, ok: true, output: "x" });
  });

  it("answers workspace-read and workspace-list with workspace-result", async () => {
    const { worker, api } = await startActivated();
    worker.emit({ type: "workspace-read", callId: 1, path: "notes.md" });
    worker.emit({ type: "workspace-list", callId: 2 });
    await vi.waitFor(() => {
      expect(worker.posted).toContainEqual({
        type: "workspace-result",
        callId: 1,
        ok: true,
        value: "file text",
      });
      expect(worker.posted).toContainEqual({
        type: "workspace-result",
        callId: 2,
        ok: true,
        value: ["/ws/a.md"],
      });
    });
    expect(api.workspaceRead).toHaveBeenCalledWith("notes.md");
  });

  it("relays workspace failures as error results", async () => {
    const api = apiStub();
    vi.mocked(api.workspaceRead).mockRejectedValue(new Error("requires workspace:read"));
    vi.mocked(api.workspaceList).mockRejectedValue(new Error("no workspace"));
    const { worker } = await startActivated(api);
    worker.emit({ type: "workspace-read", callId: 1, path: "x.md" });
    worker.emit({ type: "workspace-list", callId: 2 });
    await vi.waitFor(() => {
      expect(worker.posted).toContainEqual({
        type: "workspace-result",
        callId: 1,
        ok: false,
        error: "Error: requires workspace:read",
      });
      expect(worker.posted).toContainEqual({
        type: "workspace-result",
        callId: 2,
        ok: false,
        error: "Error: no workspace",
      });
    });
  });
});
