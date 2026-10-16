import { NAMESPACES } from "@/lib/locales";

const APP_NAMESPACES: readonly string[] = [...NAMESPACES];

/**
 * Whether `namespace` is one of the app's own. `i18n.addResourceBundle`
 * overwrites existing keys, so a plugin registering under `plugins` or
 * `common` could rewrite the consent dialog or the external-link prompt. Any
 * other namespace is a plugin's to fill: the published template registers
 * under a short name of its own, not its id.
 */
export function isAppNamespace(namespace: string): boolean {
  return APP_NAMESPACES.includes(namespace);
}

const EXTERNAL_REFERENCE = /\burl\s*\(|\bimage-set\s*\(|@import\b/i;

/**
 * Whether a stylesheet reaches outside the document: `url()`, `image-set()`
 * and `@import` make requests, and a selector on an attribute (`a[href^=…]`,
 * `[data-wikilink-path^=…]`) turns each one into a report of what the page
 * holds. A sandboxed plugin's fetch is fenced, so its CSS must be too.
 */
export function cssReachesOutside(css: string): boolean {
  return EXTERNAL_REFERENCE.test(css);
}
