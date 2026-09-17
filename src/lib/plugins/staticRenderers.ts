import { createRegistry } from "./registry";
import type { FencedRendererOptions } from "./types";

export interface StaticRendererContribution {
  language: string;
  renderStatic: NonNullable<FencedRendererOptions["renderStatic"]>;
}

// Module-level so the print and PDF export passes, which are plain modules,
// can re-render plugin blocks without the plugins context.
export const staticRenderers = createRegistry<StaticRendererContribution>();

export function staticRendererFor(
  language: string,
): StaticRendererContribution["renderStatic"] | undefined {
  return staticRenderers.list().find((entry) => entry.language === language)?.renderStatic;
}
