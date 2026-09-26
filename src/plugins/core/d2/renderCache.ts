// A Map whose insertion order doubles as recency (get re-inserts). The core D2
// plugin depends only on its own folder, the public plugin types, and npm
// packages, so it carries this instead of importing the app's LRU.

// A rendered+sanitized D2 SVG is typically 10-100KB, so 50 entries keeps the
// cache under a few MB while covering every diagram in the documents a session
// flips between. Evicting never breaks a diagram on screen: components hold
// their own copy of the SVG.
export const RENDER_CACHE_LIMIT = 50;

export class RenderCache<V> {
  private map = new Map<string, V>();

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  /** Read without refreshing recency, for identity checks. */
  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > RENDER_CACHE_LIMIT) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}
