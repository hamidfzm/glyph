// Message protocol between the host and a sandboxed plugin worker. The worker
// only ever talks to the host through these messages; it has no DOM, no Tauri
// invoke, and its network access is gated by declared `network:<host>`
// permissions.

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
  | { type: "build-export"; callId: number; id: string; bodyHtml: string }
  /** Reply to any worker-initiated call (workspace-read/list, asset-read). */
  | { type: "host-result"; callId: number; ok: boolean; value?: unknown; error?: string };

/** Worker -> host. */
export type WorkerMessage =
  | { type: "activated" }
  | { type: "error"; message: string }
  | { type: "register-command"; id: string; title: string }
  | { type: "add-styles"; css: string }
  | {
      type: "register-translations";
      locale: string;
      namespace: string;
      resources: Record<string, unknown>;
    }
  | { type: "notify"; message: string }
  | { type: "settings-set"; key: string; value: unknown }
  | { type: "register-exporter"; id: string; label: string; extension: string }
  | {
      type: "export-result";
      callId: number;
      ok: boolean;
      output?: string | number[];
      error?: string;
    }
  | { type: "workspace-read"; callId: number; path: string }
  | { type: "workspace-list"; callId: number }
  /** Read one of the plugin's own manifest-declared files; resolves to bytes. */
  | { type: "asset-read"; callId: number; path: string };

/**
 * Is a URL reachable under the plugin's declared `network:<host>` permissions?
 * Exact host match, or a subdomain of a declared host. No declarations means
 * no network at all.
 */
export function isNetworkAllowed(permissions: readonly string[], url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return permissions.some((p) => {
    if (!p.startsWith("network:")) return false;
    const allowed = p.slice("network:".length);
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}
