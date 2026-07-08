import { PLUGIN_API_VERSION } from "../apiVersion";
import type { Disposer } from "../disposer";
import type { ExporterContribution, InstalledPlugin } from "../types";
import { buildWorkerBootstrap } from "./bootstrap";
import type { HostMessage, WorkerMessage } from "./protocol";

/** The subset of Worker the bridge needs; injectable for tests (jsdom has no Worker). */
export interface WorkerLike {
  postMessage(message: HostMessage): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WorkerSpawner = (bootstrapSource: string) => WorkerLike;

/** What the sandbox is allowed to do on the host side. All calls are already
 * routed through the owning plugin's DisposerBag by the host. */
export interface SandboxHostApi {
  registerCommand(command: { id: string; title: string; run: () => void }): void;
  addStyles(css: string): void;
  registerExporter(exporter: ExporterContribution): void;
  notify(message: string): void;
  registerTranslations(locale: string, namespace: string, resources: Record<string, unknown>): void;
  settingsSet(key: string, value: unknown): void;
  workspaceRead(path: string): Promise<string>;
  workspaceList(): Promise<string[]>;
}

const defaultSpawner: WorkerSpawner = (source) =>
  new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" }))) as WorkerLike;

/**
 * Run a sandboxed plugin in a dedicated worker and bridge its protocol
 * messages onto the host API. Resolves once the worker reports `activated`;
 * rejects on `error` or worker failure. The returned disposer terminates the
 * worker (the host's DisposerBag removes the registered contributions).
 */
export function startSandbox(
  plugin: InstalledPlugin,
  settings: Record<string, unknown>,
  api: SandboxHostApi,
  spawn: WorkerSpawner = defaultSpawner,
): Promise<Disposer> {
  const worker = spawn(buildWorkerBootstrap());
  let exportSeq = 0;
  const pendingExports = new Map<
    number,
    { resolve: (v: string | Uint8Array) => void; reject: (e: Error) => void }
  >();

  return new Promise<Disposer>((resolve, reject) => {
    let activated = false;
    const fail = (err: Error) => {
      worker.terminate();
      reject(err);
    };

    worker.onerror = (event) => {
      if (!activated) fail(new Error(`sandbox worker failed: ${String(event)}`));
    };

    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case "activated":
          activated = true;
          resolve(() => worker.terminate());
          break;
        case "error":
          if (!activated) fail(new Error(data.message));
          else console.error(`Sandboxed plugin ${plugin.id} error:`, data.message);
          break;
        case "register-command":
          api.registerCommand({
            id: data.id,
            title: data.title,
            run: () => worker.postMessage({ type: "run-command", id: data.id }),
          });
          break;
        case "add-styles":
          api.addStyles(data.css);
          break;
        case "register-translations":
          api.registerTranslations(data.locale, data.namespace, data.resources);
          break;
        case "notify":
          api.notify(data.message);
          break;
        case "settings-set":
          api.settingsSet(data.key, data.value);
          break;
        case "register-exporter":
          api.registerExporter({
            id: data.id,
            label: data.label,
            extension: data.extension,
            build: (bodyHtml) =>
              new Promise((res, rej) => {
                const callId = ++exportSeq;
                pendingExports.set(callId, { resolve: res, reject: rej });
                worker.postMessage({ type: "build-export", callId, id: data.id, bodyHtml });
              }),
          });
          break;
        case "export-result": {
          const pending = pendingExports.get(data.callId);
          if (!pending) break;
          pendingExports.delete(data.callId);
          if (data.ok && data.output !== undefined) {
            pending.resolve(
              typeof data.output === "string" ? data.output : new Uint8Array(data.output),
            );
          } else {
            pending.reject(new Error(data.error ?? "export failed"));
          }
          break;
        }
        case "workspace-read":
          api.workspaceRead(data.path).then(
            (value) =>
              worker.postMessage({
                type: "workspace-result",
                callId: data.callId,
                ok: true,
                value,
              }),
            (err) =>
              worker.postMessage({
                type: "workspace-result",
                callId: data.callId,
                ok: false,
                error: String(err),
              }),
          );
          break;
        case "workspace-list":
          api.workspaceList().then(
            (value) =>
              worker.postMessage({
                type: "workspace-result",
                callId: data.callId,
                ok: true,
                value,
              }),
            (err) =>
              worker.postMessage({
                type: "workspace-result",
                callId: data.callId,
                ok: false,
                error: String(err),
              }),
          );
          break;
      }
    };

    worker.postMessage({
      type: "init",
      source: plugin.mainSource,
      apiVersion: PLUGIN_API_VERSION,
      permissions: plugin.permissions ?? [],
      settings,
    });
  });
}
