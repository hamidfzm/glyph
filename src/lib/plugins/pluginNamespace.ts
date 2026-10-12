/**
 * Whether a plugin may register translations under `namespace`: its own id,
 * or a namespace it prefixes with its id. `i18n.addResourceBundle` overwrites
 * existing keys, so an app namespace (`plugins`, `common`) handed to a plugin
 * would let it rewrite the consent dialog or the external-link prompt.
 */
export function ownsTranslationNamespace(pluginId: string, namespace: string): boolean {
  return (
    namespace === pluginId ||
    namespace.startsWith(`${pluginId}.`) ||
    namespace.startsWith(`${pluginId}:`)
  );
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
