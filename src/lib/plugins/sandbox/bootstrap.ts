// Source text of the sandbox worker. It runs with no DOM and no Tauri invoke;
// everything reaches the host through the protocol messages, and network
// access is fenced to the plugin's declared `network:<host>` permissions by
// replacing the worker's own fetch (WebSocket/XHR/importScripts are removed
// outright). In production builds the page CSP also blocks remote dynamic
// import inside the worker, so the fetch fence is not the only wall.
//
// Kept as a template string rather than a bundled file so the loader can spawn
// it from a blob URL without any build-time coordination.

export function buildWorkerBootstrap(): string {
  return `
"use strict";
// Tests shim globalThis and run this source via new Function, where dynamic
// import is unavailable; they inject an importer instead. In a real worker
// the fallback import() is used.
const importModule = globalThis.__glyphSandboxImport || ((u) => import(u));
let callSeq = 0;
const pendingHost = new Map(); // callId -> {resolve, reject}
const commands = new Map();    // id -> run
const exporters = new Map();   // id -> build
let settings = {};

function hostCall(message) {
  return new Promise((resolve, reject) => {
    const callId = ++callSeq;
    pendingHost.set(callId, { resolve, reject });
    postMessage({ ...message, callId });
  });
}

// Network fence: exact declared host or a subdomain of it.
function isNetworkAllowed(permissions, url) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return permissions.some((p) => {
    if (!p.startsWith("network:")) return false;
    const allowed = p.slice("network:".length);
    return host === allowed || host.endsWith("." + allowed);
  });
}

function installNetworkFence(permissions) {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!isNetworkAllowed(permissions, url)) {
      return Promise.reject(
        new Error("network access to " + url + " is not covered by this plugin's permissions"),
      );
    }
    return realFetch(input, init);
  };
  globalThis.XMLHttpRequest = undefined;
  globalThis.WebSocket = undefined;
  globalThis.importScripts = undefined;
}

function buildContext(init) {
  settings = init.settings;
  return {
    apiVersion: init.apiVersion,
    commands: {
      register(command) {
        commands.set(command.id, command.run);
        postMessage({ type: "register-command", id: command.id, title: command.title });
        return () => commands.delete(command.id);
      },
    },
    ui: {
      addStyles(css) {
        postMessage({ type: "add-styles", css });
        return () => {};
      },
    },
    exporters: {
      register(exporter) {
        exporters.set(exporter.id, exporter.build);
        postMessage({
          type: "register-exporter",
          id: exporter.id,
          label: exporter.label,
          extension: exporter.extension,
        });
        return () => exporters.delete(exporter.id);
      },
    },
    workspace: {
      readFile(path) {
        return hostCall({ type: "workspace-read", path });
      },
      listFiles() {
        return hostCall({ type: "workspace-list" });
      },
    },
    settings: {
      get(key) {
        return settings[key];
      },
      set(key, value) {
        settings[key] = value;
        postMessage({ type: "settings-set", key, value });
      },
    },
    notify(message) {
      postMessage({ type: "notify", message: String(message) });
    },
    registerTranslations(locale, namespace, resources) {
      postMessage({ type: "register-translations", locale, namespace, resources });
    },
  };
}

onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      installNetworkFence(msg.permissions);
      const url = "data:text/javascript;base64," +
        btoa(String.fromCharCode(...new TextEncoder().encode(msg.source)));
      const module = await importModule(url);
      const plugin = module && module.default;
      if (!plugin || typeof plugin.activate !== "function") {
        throw new Error("plugin entry must default-export an object with an activate() function");
      }
      await plugin.activate(buildContext(msg));
      postMessage({ type: "activated" });
    } else if (msg.type === "run-command") {
      const run = commands.get(msg.id);
      if (run) await run();
    } else if (msg.type === "build-export") {
      const build = exporters.get(msg.id);
      try {
        const output = await build(msg.bodyHtml);
        postMessage({
          type: "export-result",
          callId: msg.callId,
          ok: true,
          output: typeof output === "string" ? output : Array.from(output),
        });
      } catch (err) {
        postMessage({ type: "export-result", callId: msg.callId, ok: false, error: String(err) });
      }
    } else if (msg.type === "workspace-result") {
      const pending = pendingHost.get(msg.callId);
      if (pending) {
        pendingHost.delete(msg.callId);
        if (msg.ok) pending.resolve(msg.value);
        else pending.reject(new Error(msg.error));
      }
    }
  } catch (err) {
    postMessage({ type: "error", message: String(err) });
  }
};
`;
}
