import type { SiteThemeContribution } from "@/lib/plugins/types";

// Built-in themes for the exported website. A theme is CSS appended to the
// site's shared style.css after the chrome, so it can restyle the header,
// nav, outline, and content column. Plugins contribute more themes via
// ctx.exporters.registerSiteTheme; `.glyph/site.json`'s "theme" picks one.

// GitHub-docs look: translucent sticky header bar, pill-highlighted nav with
// indent guides, a railed "On this page" outline, and a reading-width content
// column. Colors ride the app's custom properties (present in the collected
// CSS) with GitHub palette fallbacks; the export's .dark class switches them.
const GITHUB_CSS = `
body { padding: 0 0 4rem; }
.glyph-site-header {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center;
  padding: 0.7rem 1.5rem; margin-bottom: 1.5rem;
  background: color-mix(in srgb, var(--color-surface, #ffffff) 80%, transparent);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  border-bottom: 1px solid var(--color-border, #d1d9e0);
}
@media (prefers-reduced-transparency: reduce) {
  .glyph-site-header {
    background: var(--color-surface, #ffffff);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
.glyph-site-header a {
  color: var(--color-text-primary, #1f2328);
  font-weight: 600; font-size: 1.05rem; text-decoration: none;
  letter-spacing: -0.01em;
  transition: color 150ms ease;
}
.glyph-site-header a:hover { color: var(--color-accent, #0969da); }
.glyph-site { padding: 0 1.5rem; }
.glyph-site-nav, .glyph-site-outline { top: 4rem; max-height: calc(100vh - 5rem); }
.markdown-body [id] { scroll-margin-top: 4.5rem; }
#glyph-theme-toggle { top: 0.55rem; right: 1rem; width: 2rem; height: 2rem; box-shadow: none; z-index: 200; }
.glyph-site-nav { padding-right: 0.5rem; }
.glyph-site-nav details > ul {
  border-left: 1px solid var(--color-border, #d1d9e0);
  margin-left: 0.7rem; padding-left: 0.35rem;
}
.glyph-site-nav summary { color: var(--color-text-secondary, #59636e); }
.glyph-site-nav summary:hover { background: var(--color-hover, rgba(175, 184, 193, 0.2)); }
.glyph-site-nav a:hover { background: var(--color-hover, rgba(175, 184, 193, 0.2)); }
.glyph-site-nav a[aria-current="page"] {
  background: var(--color-accent-muted, rgba(9, 105, 218, 0.12));
}
.glyph-site-outline::before {
  content: "On this page"; display: block; margin-bottom: 0.5rem; padding-left: 0.85rem;
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-text-secondary, #59636e);
}
.glyph-site-outline > ul { border-left: 1px solid var(--color-border, #d1d9e0); }
.glyph-site-outline > ul a { margin-left: -1.5px; }
.glyph-site-main .markdown-body { max-width: 880px; }
@media (max-width: 768px) {
  .glyph-site-nav { padding: 0.5rem 0 0; border-bottom: 1px solid var(--color-border, #d1d9e0); }
}
@media print { .glyph-site-header { display: none; } }`;

export const BUILTIN_SITE_THEMES: readonly SiteThemeContribution[] = [
  { id: "github", label: "GitHub", css: GITHUB_CSS },
  // The bare chrome, as shipped before themes existed.
  { id: "plain", label: "Plain", css: "" },
];

export const DEFAULT_SITE_THEME_ID = "github";

/**
 * Pick the theme for an export: built-ins first (a plugin cannot hijack
 * "github" or "plain"), then plugin-contributed themes. Unknown ids fail
 * loudly with everything that would have been valid.
 */
export function resolveSiteTheme(
  id: string,
  pluginThemes: readonly SiteThemeContribution[] = [],
): SiteThemeContribution {
  const theme =
    BUILTIN_SITE_THEMES.find((t) => t.id === id) ?? pluginThemes.find((t) => t.id === id);
  if (theme) return theme;
  const available = [...BUILTIN_SITE_THEMES, ...pluginThemes].map((t) => t.id).join(", ");
  throw new Error(`Unknown site theme "${id}". Available themes: ${available}`);
}
