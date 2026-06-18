import { type EventCallback, type EventName, listen } from "@tauri-apps/api/event";

/**
 * Subscribe to a Tauri event and return a teardown function suitable for a
 * React effect cleanup.
 *
 * The teardown swallows errors from the underlying `unlisten`. That call can
 * reject with "undefined is not an object (evaluating 'listeners[eventId]…')"
 * when the listener has already been removed — for example when the window is
 * closing, or when an effect tears down twice. Left unhandled, the rejection
 * escapes as a global `unhandledrejection` and is reported as a crash even
 * though nothing went wrong.
 */
export function subscribe<T>(event: EventName, handler: EventCallback<T>): () => void {
  const unlisten = listen<T>(event, handler);
  return () => {
    unlisten.then((fn) => fn()).catch(() => {});
  };
}
