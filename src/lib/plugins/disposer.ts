/** A function that tears down whatever a `register*` call set up. */
export type Disposer = () => void;

/**
 * Collects disposers so a plugin (or the host) can tear everything down in one
 * call. Every registration in the plugin API returns a {@link Disposer}; the
 * loader drops each plugin's disposers into a bag and empties it on unload,
 * which is what keeps disable/uninstall from leaking listeners, panels, menu
 * items, or settings.
 */
export class DisposerBag {
  private disposers: Disposer[] = [];
  private disposed = false;

  /**
   * Register a teardown callback. If the bag is already disposed the callback
   * runs immediately, so late registrations can't leak.
   */
  add(disposer: Disposer): void {
    if (this.disposed) {
      disposer();
      return;
    }
    this.disposers.push(disposer);
  }

  /**
   * Run every collected disposer (most-recent first, so later registrations
   * that build on earlier ones unwind first) and clear the bag. Idempotent; a
   * throwing disposer is logged and does not stop the rest.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.disposers.slice().reverse();
    this.disposers = [];
    for (const disposer of pending) {
      try {
        disposer();
      } catch (err) {
        console.error("Plugin disposer threw during teardown:", err);
      }
    }
  }

  /** Whether {@link dispose} has already run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Number of disposers still pending. */
  get size(): number {
    return this.disposers.length;
  }
}
