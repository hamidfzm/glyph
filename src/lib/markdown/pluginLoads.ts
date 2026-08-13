// Lazy markdown plugins (syntax highlighting, KaTeX, gemoji) swap into an
// already-painted document when their chunk arrives. Exports read the live DOM,
// and a document waiting on a chunk mutates nothing, so a quiet-DOM check alone
// would call it finished and snapshot `:tada:` instead of the emoji. Counting
// the loads in flight gives the export gate the missing signal.

let inFlight = 0;

/** Count `load` while it runs. Returns it unchanged, rejection included. */
export function trackPluginLoad<T>(load: Promise<T>): Promise<T> {
  inFlight++;
  return load.finally(() => {
    inFlight--;
  });
}

export function pendingPluginLoads(): number {
  return inFlight;
}
