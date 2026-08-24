// Minimal LRU used by the diagram render caches: a Map whose insertion order
// doubles as recency (get re-inserts). Deliberately tiny, not a general cache
// abstraction.

// Shared bound for the Mermaid and D2 render caches. A rendered+sanitized
// diagram SVG is typically 10-100KB, so 50 entries keeps each cache under a
// few MB worst case while still covering every diagram in the handful of
// documents a session flips between. Evicting an entry never breaks a diagram
// already on screen: components hold their own copy of the SVG, the cache only
// decides whether a future mount re-renders.
export const DIAGRAM_RENDER_CACHE_LIMIT = 50;

export class LruCache<V> {
  private map = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}
