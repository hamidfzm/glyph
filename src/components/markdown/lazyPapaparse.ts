type PapaStatic = typeof import("papaparse");

let papaPromise: Promise<PapaStatic> | null = null;

// Lazily load PapaParse in its own chunk so the ~40 KB parser only ships to
// users who actually render a CSV/TSV code block. The promise is cached so
// repeated renders share a single import.
export function loadPapaparse(): Promise<PapaStatic> {
  if (!papaPromise) {
    papaPromise = import("papaparse");
  }
  return papaPromise;
}
