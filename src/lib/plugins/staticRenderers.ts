import { createRegistry } from "./registry";
import type { FencedRendererOptions } from "./types";

export interface StaticRendererContribution {
  language: string;
  renderStatic: NonNullable<FencedRendererOptions["renderStatic"]>;
}

// Module-level so the print and PDF export passes, which are plain modules,
// can re-render plugin blocks without the plugins context.
export const staticRenderers = createRegistry<StaticRendererContribution>();

// A plugin promise that never settles must not hang print or PDF export; the
// export then falls back as it does for a failed render.
export const STATIC_RENDER_TIMEOUT_MS = 15_000;

/** The static render registered for `language`, bounded by the timeout. */
export function staticRendererFor(
  language: string,
): ((code: string) => Promise<string>) | undefined {
  const renderStatic = staticRenderers
    .list()
    .find((entry) => entry.language === language)?.renderStatic;
  if (!renderStatic) return undefined;
  return (code) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`static render for ${language} timed out`)),
        STATIC_RENDER_TIMEOUT_MS,
      );
      renderStatic(code)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
}
