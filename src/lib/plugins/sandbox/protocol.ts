// Message protocol between the host and a sandboxed plugin worker. The worker
// only ever talks to the host through these messages; it has no DOM, no Tauri
// invoke, and its network access is gated by declared `network:<host>`
// permissions.

import type { ExportDocument } from "@/lib/plugins/types";

/** Host -> worker. */
export type HostMessage =
  | {
      type: "init";
      source: string;
      apiVersion: string;
      permissions: string[];
      settings: Record<string, unknown>;
    }
  | { type: "run-command"; id: string }
  | { type: "build-export"; callId: number; id: string; bodyHtml: string; doc: ExportDocument }
  /** Run a registered dictionary's `load()`; nothing is read until a language is selected. */
  | { type: "load-dictionary"; callId: number; language: string }
  /** Reply to any worker-initiated call (workspace-read/list, asset-read). */
  | { type: "host-result"; callId: number; ok: boolean; value?: unknown; error?: string };

/** Worker -> host. */
export type WorkerMessage =
  | { type: "activated" }
  | { type: "error"; message: string }
  | {
      type: "register-command";
      id: string;
      title: string;
      menu?: "file" | "view";
      shortcut?: string;
      when?: "workspace";
    }
  | { type: "add-styles"; css: string }
  | { type: "register-color-scheme"; id: string; label: string; css: string }
  | {
      type: "register-translations";
      locale: string;
      namespace: string;
      resources: Record<string, unknown>;
    }
  | { type: "notify"; message: string }
  | { type: "settings-set"; key: string; value: unknown }
  | { type: "register-exporter"; id: string; label: string; extension: string }
  | { type: "register-site-theme"; id: string; label: string; css: string }
  | { type: "register-file-type"; extensions: string[]; language: string }
  | {
      type: "export-result";
      callId: number;
      ok: boolean;
      output?: string | number[];
      error?: string;
    }
  | { type: "register-dictionary"; language: string; label: string; scripts?: string[] }
  | {
      type: "dictionary-result";
      callId: number;
      ok: boolean;
      sources?: { aff: string; dic: string };
      error?: string;
    }
  | { type: "workspace-read"; callId: number; path: string }
  | { type: "workspace-list"; callId: number }
  /** Read one of the plugin's own manifest-declared files; resolves to bytes. */
  | { type: "asset-read"; callId: number; path: string };

/** A trailing dot names the same host. */
function hostName(name: string): string {
  return name.toLowerCase().replace(/\.$/, "");
}

/**
 * Is a URL reachable under the plugin's declared `network:<host>` permissions?
 * http or https to the exact declared host or a subdomain of it; no
 * declarations means no network at all. The webview's own hosts are never
 * covered: the asset protocol serves every granted file from `asset.localhost`
 * (or `asset://localhost`) and `ipc.localhost` is the command bridge, so a
 * plugin declaring `network:localhost` for a local server reaches that server
 * alone. The worker bootstrap carries the same rule in its own source.
 */
export function isNetworkAllowed(permissions: readonly string[], url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = hostName(parsed.hostname);
  if (host.endsWith(".localhost")) return false;
  return permissions.some((p) => {
    if (!p.startsWith("network:")) return false;
    const allowed = hostName(p.slice("network:".length));
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}
