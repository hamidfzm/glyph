import { describe, expect, it, vi } from "vitest";
import { buildWorkerBootstrap } from "./bootstrap";
import type { HostMessage, WorkerMessage } from "./protocol";

/**
 * Run the bootstrap source in-process: `onmessage`/`postMessage` become local
 * bindings and `globalThis` is shadowed by a fake object, so the network fence
 * mutates the fake instead of the test runtime. Dynamic import of the data:
 * URL still goes through Node, which supports it natively.
 */
function bootWorker(fetchImpl: typeof fetch = vi.fn()) {
  const posted: WorkerMessage[] = [];
  const fakeGlobal: Record<string, unknown> = {
    fetch: fetchImpl,
    // new Function code has no dynamic-import callback under vitest's VM, so
    // hand the bootstrap this module's importer instead.
    __glyphSandboxImport: (url: string) => import(/* @vite-ignore */ url),
  };
  const run = new Function(
    "postMessage",
    "globalThis",
    `let onmessage; ${buildWorkerBootstrap()}\nreturn onmessage;`,
  );
  const handler = run((m: WorkerMessage) => posted.push(m), fakeGlobal) as (event: {
    data: HostMessage;
  }) => Promise<void>;
  return {
    posted,
    fakeGlobal,
    send: (data: HostMessage) => handler({ data }),
    typesPosted: () => posted.map((m) => m.type),
  };
}

const init = (
  source: string,
  overrides: Partial<Extract<HostMessage, { type: "init" }>> = {},
): HostMessage => ({
  type: "init",
  source,
  apiVersion: "1.2.0",
  permissions: [],
  settings: {},
  ...overrides,
});

const fullPlugin = `export default {
  activate(ctx) {
    ctx.commands.register({ id: "c1", title: "Cmd", run: () => ctx.notify("ran " + ctx.settings.get("who")) });
    ctx.ui.addStyles("body{}");
    ctx.registerTranslations("en", "ns", { k: "v" });
    ctx.settings.set("who", "world");
    ctx.exporters.register({ id: "e1", label: "Upper", extension: "txt", build: async (html) => html.toUpperCase() });
  },
}`;

describe("worker bootstrap", () => {
  it("activates a plugin and relays every registration to the host", async () => {
    const w = bootWorker();
    await w.send(init(fullPlugin));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("activated"));
    expect(w.posted).toContainEqual({ type: "register-command", id: "c1", title: "Cmd" });
    expect(w.posted).toContainEqual({ type: "add-styles", css: "body{}" });
    expect(w.posted).toContainEqual({
      type: "register-translations",
      locale: "en",
      namespace: "ns",
      resources: { k: "v" },
    });
    expect(w.posted).toContainEqual({ type: "settings-set", key: "who", value: "world" });
    expect(w.posted).toContainEqual({
      type: "register-exporter",
      id: "e1",
      label: "Upper",
      extension: "txt",
    });
  });

  it("runs commands on request, with settings visible to the plugin", async () => {
    const w = bootWorker();
    await w.send(init(fullPlugin));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("activated"));
    await w.send({ type: "run-command", id: "c1" });
    // set("who","world") during activate updated the local snapshot.
    await vi.waitFor(() =>
      expect(w.posted).toContainEqual({ type: "notify", message: "ran world" }),
    );
    // Unknown command id is a no-op.
    await w.send({ type: "run-command", id: "ghost" });
  });

  it("builds exports and reports build failures", async () => {
    const w = bootWorker();
    const plugin = `export default {
      activate(ctx) {
        ctx.exporters.register({ id: "ok", label: "U", extension: "txt", build: async (h) => h.toUpperCase() });
        ctx.exporters.register({ id: "bad", label: "B", extension: "txt", build: async () => { throw new Error("nope"); } });
      },
    }`;
    await w.send(init(plugin));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("activated"));

    await w.send({ type: "build-export", callId: 1, id: "ok", bodyHtml: "<p>" });
    await w.send({ type: "build-export", callId: 2, id: "bad", bodyHtml: "" });
    await vi.waitFor(() => {
      expect(w.posted).toContainEqual({
        type: "export-result",
        callId: 1,
        ok: true,
        output: "<P>",
      });
      expect(w.posted).toContainEqual({
        type: "export-result",
        callId: 2,
        ok: false,
        error: "Error: nope",
      });
    });
  });

  it("resolves workspace calls via host-result round trips", async () => {
    const w = bootWorker();
    const plugin = `export default {
      async activate(ctx) {
        const text = await ctx.workspace.readFile("a.md");
        ctx.notify("read:" + text);
        try { await ctx.workspace.listFiles(); } catch (e) { ctx.notify("list:" + e.message); }
      },
    }`;
    const activation = w.send(init(plugin));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("workspace-read"));
    const read = w.posted.find((m) => m.type === "workspace-read") as { callId: number };
    await w.send({ type: "host-result", callId: read.callId, ok: true, value: "hello" });

    await vi.waitFor(() => expect(w.typesPosted()).toContain("workspace-list"));
    const list = w.posted.find((m) => m.type === "workspace-list") as { callId: number };
    await w.send({ type: "host-result", callId: list.callId, ok: false, error: "denied" });

    await activation;
    await vi.waitFor(() => expect(w.typesPosted()).toContain("activated"));
    expect(w.posted).toContainEqual({ type: "notify", message: "read:hello" });
    expect(w.posted).toContainEqual({ type: "notify", message: "list:denied" });
    // A result for an unknown call is ignored.
    await w.send({ type: "host-result", callId: 999, ok: true, value: "" });
  });

  it("serves ctx.assets reads via asset-read round trips", async () => {
    const w = bootWorker();
    const plugin = `export default {
      async activate(ctx) {
        const text = await ctx.assets.readText("assets/greeting.txt");
        const bytes = await ctx.assets.readBinary("assets/raw.bin");
        ctx.notify("asset:" + text + ":" + bytes.length);
      },
    }`;
    const activation = w.send(init(plugin));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("asset-read"));
    const first = w.posted.find((m) => m.type === "asset-read") as { callId: number };
    await w.send({
      type: "host-result",
      callId: first.callId,
      ok: true,
      value: Array.from(new TextEncoder().encode("hi")),
    });
    await vi.waitFor(() => expect(w.posted.filter((m) => m.type === "asset-read")).toHaveLength(2));
    const second = w.posted.filter((m) => m.type === "asset-read")[1] as { callId: number };
    await w.send({ type: "host-result", callId: second.callId, ok: true, value: [1, 2, 3] });
    await activation;
    expect(w.posted).toContainEqual({ type: "notify", message: "asset:hi:3" });
  });

  it("fences fetch to declared network hosts and removes other network APIs", async () => {
    const realFetch = vi.fn().mockResolvedValue("response");
    const w = bootWorker(realFetch as unknown as typeof fetch);
    await w.send(init("export default { activate(){} }", { permissions: ["network:example.com"] }));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("activated"));

    const fenced = w.fakeGlobal.fetch as typeof fetch;
    await expect(fenced("https://api.example.com/data")).resolves.toBe("response");
    await expect(fenced(new Request("https://example.com/"))).resolves.toBe("response");
    await expect(fenced("https://evil.com/")).rejects.toThrow("not covered");
    await expect(fenced("garbage")).rejects.toThrow("not covered");
    expect(w.fakeGlobal.XMLHttpRequest).toBeUndefined();
    expect(w.fakeGlobal.WebSocket).toBeUndefined();
    expect(w.fakeGlobal.importScripts).toBeUndefined();
  });

  it("reports a plugin without a default activate export as an error", async () => {
    const w = bootWorker();
    await w.send(init("export const nothing = 1;"));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("error"));
    const error = w.posted.find((m) => m.type === "error") as { message: string };
    expect(error.message).toContain("activate");
  });

  it("reports an activate that throws", async () => {
    const w = bootWorker();
    await w.send(init("export default { activate() { throw new Error('bad start'); } }"));
    await vi.waitFor(() => expect(w.typesPosted()).toContain("error"));
    const error = w.posted.find((m) => m.type === "error") as { message: string };
    expect(error.message).toContain("bad start");
  });
});
