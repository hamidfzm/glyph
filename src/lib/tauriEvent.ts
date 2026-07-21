import { type EventCallback, type EventName, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

// A default listen() has target Any, which also receives events emit_to'd at
// OTHER windows, so a menu action in one window would fire in all of them.
// Scope every listener to this window; broadcasts still reach scoped listeners.
function currentWindowTarget(): { target: { kind: "WebviewWindow"; label: string } } | undefined {
  try {
    return { target: { kind: "WebviewWindow", label: getCurrentWebviewWindow().label } };
  } catch {
    // Non-Tauri environment (tests); scope is irrelevant there.
    return undefined;
  }
}

/**
 * Subscribe to a Tauri event, scoped to the current window, and return a
 * teardown function suitable for a React effect cleanup.
 *
 * The teardown swallows errors from the underlying `unlisten`. That call can
 * reject with "undefined is not an object (evaluating 'listeners[eventId]…')"
 * when the listener has already been removed — for example when the window is
 * closing, or when an effect tears down twice. Left unhandled, the rejection
 * escapes as a global `unhandledrejection` and is reported as a crash even
 * though nothing went wrong.
 */
export function subscribe<T>(event: EventName, handler: EventCallback<T>): () => void {
  const unlisten = listen<T>(event, handler, currentWindowTarget());
  return () => {
    unlisten.then((fn) => fn()).catch(() => {});
  };
}
