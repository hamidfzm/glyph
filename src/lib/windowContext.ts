// Per-window bootstrap hints injected by the Rust window spawner via an
// initialization script (see windows_runtime.rs). A freshly-spawned secondary
// window learns which folder it was opened for, and that it must not touch the
// shared session-restore state. The primary window has neither global set.

/** An open request that reached this window before it could listen for one:
 *  injected by the spawner, or queued by the backend (`take_pending_opens`). */
export interface PendingOpen {
  kind: "folder" | "file";
  path: string;
}

interface GlyphWindowGlobals {
  __GLYPH_OPEN__?: PendingOpen;
  __GLYPH_PRIMARY__?: boolean;
}

function globals(): GlyphWindowGlobals {
  return typeof window === "undefined" ? {} : (window as unknown as GlyphWindowGlobals);
}

/**
 * The path a spawned window was created to open. Returns null for the primary
 * window and for any normal launch (the regular CLI / session-restore path runs
 * instead).
 */
export function injectedOpen(): PendingOpen | null {
  const value = globals().__GLYPH_OPEN__;
  if (!value || (value.kind !== "folder" && value.kind !== "file")) return null;
  return typeof value.path === "string" && value.path.length > 0 ? value : null;
}

/**
 * Whether this window owns session restore. Secondary windows (spawned for a
 * second folder) are ephemeral: they neither persist their open tabs nor
 * restore a previous session, so only one window comes back on relaunch.
 */
export function isPrimaryWindow(): boolean {
  return globals().__GLYPH_PRIMARY__ !== false;
}
