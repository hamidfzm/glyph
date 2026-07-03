// Suspense chunk-load tests wait on a dynamic import, whose first resolution
// can be slow when the full suite runs under machine load. Tests that render a
// lazy wrapper use this instead of the 5s vitest default.
export const CHUNK_LOAD_TIMEOUT_MS = 15_000;
