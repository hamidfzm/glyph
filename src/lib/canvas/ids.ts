/** Id for a freshly created node or edge. `randomUUID` is absent on insecure
 *  origins and in some test environments, hence the counter-free fallback. */
export function newCanvasId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `n${Math.round(Math.random() * 1e9)}`;
}
