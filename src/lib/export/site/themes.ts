import type { SiteThemeContribution } from "@/lib/plugins/types";

// Built-in themes for the exported website. A theme is CSS appended to the
// site's shared style.css after the chrome, so it can restyle the header,
// nav, outline, and content column. Plugins contribute more themes via
// ctx.exporters.registerSiteTheme; `.glyph/site.json`'s "theme" picks one.

// GitHub-docs look: sticky header bar, pill-highlighted nav, quiet bordered
// outline with an "On this page" caption, and a reading-width content column.
// Colors ride the app's custom properties (present in the collected CSS) with
// GitHub palette fallbacks; the export's .dark class switches them.
const GITHUB_CSS = `
body { padding: 0 0 4rem; }
.glyph-site-header {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center;
  padding: 0.7rem 1.5rem; margin-bottom: 1.5rem;
  background: var(--color-surface, #ffffff);
  border-bottom: 1px solid var(--color-border, #d1d9e0);
}
.glyph-site-header a {
  color: var(--color-text-primary, #1f2328);
  font-weight: 600; font-size: 1.05rem; text-decoration: none;
}
.glyph-site-header a:hover { color: var(--color-accent, #0969da); }
.glyph-site { padding: 0 1.5rem; }
/* The header is sticky and opaque; pin the columns below it, not under it. */
.glyph-site-nav, .glyph-site-outline { top: 4rem; max-height: calc(100vh - 5rem); }
#glyph-theme-toggle { top: 0.55rem; right: 1rem; width: 2rem; height: 2rem; box-shadow: none; z-index: 200; }
.glyph-site-nav { font-size: 0.875rem; padding-right: 0.5rem; }
.glyph-site-nav ul { padding-left: 0.5rem; }
.glyph-site-nav > ul { padding-left: 0; }
.glyph-site-nav li { margin: 0; }
.glyph-site-nav summary {
  padding: 0.3rem 0.5rem; border-radius: 6px;
  font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.02em;
  color: var(--color-text-secondary, #59636e);
}
.glyph-site-nav summary:hover { background: var(--color-hover, rgba(175, 184, 193, 0.2)); }
.glyph-site-nav a {
  display: block; padding: 0.3rem 0.5rem; border-radius: 6px;
  color: var(--color-text-primary, #1f2328);
}
.glyph-site-nav a:hover {
  background: var(--color-hover, rgba(175, 184, 193, 0.2));
  color: var(--color-text-primary, #1f2328);
}
.glyph-site-nav a[aria-current="page"] {
  background: var(--color-accent-muted, rgba(9, 105, 218, 0.12));
  color: var(--color-accent, #0969da); font-weight: 600;
}
.glyph-site-outline { border-left: 1px solid var(--color-border, #d1d9e0); padding-left: 1rem; }
.glyph-site-outline > ul::before {
  content: "On this page"; display: block; margin-bottom: 0.5rem;
  font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--color-text-secondary, #59636e);
}
.glyph-site-outline a { display: block; padding: 0.2rem 0; }
.glyph-site-outline a:hover { color: var(--color-accent, #0969da); text-decoration: none; }
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
