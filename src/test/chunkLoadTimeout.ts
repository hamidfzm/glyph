// A dynamic import's first resolution can be slow when the full suite runs
// under machine load. Tests that render a lazy wrapper wait on it with this
// instead of the 5s vitest default, and preloadCorePlugins gives a core
// plugin's first import the same budget.
export const CHUNK_LOAD_TIMEOUT_MS = 15_000;
