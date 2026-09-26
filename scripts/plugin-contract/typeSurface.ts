// Compiles only while glyph-md/plugin-template's types/glyph.d.ts declares the
// same plugin API as the host. Checked by the "Plugin contract" CI job:
//   tsc -p scripts/plugin-contract   (template checked out at .ecosystem/plugin-template)
// Each check is its own constant so a failure names the part that drifted.
import type * as Host from "@/lib/plugins/types";
import type * as Template from "glyph";

// Identity, not mutual assignability: assignability lets optional members,
// readonly, `any`, and generics drift unnoticed.
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

type HostCtx = Host.GlyphPluginContext;
type TemplateCtx = Template.GlyphPluginContext;

// The template types markdown plugins and fenced renderers loosely so plugin
// authors need no React or unified types: compare names, arity, returns, and
// the fenced renderer's language parameter only.
type MarkdownShape<M> = {
  [K in keyof M]: M[K] extends (...args: infer P) => infer R ? [P["length"], R] : never;
};
type FencedLanguage<M extends { registerFencedRenderer: (...args: never[]) => unknown }> =
  Parameters<M["registerFencedRenderer"]>[0];

export const context: Equal<Omit<HostCtx, "markdown">, Omit<TemplateCtx, "markdown">> = true;
export const commands: Equal<HostCtx["commands"], TemplateCtx["commands"]> = true;
export const ui: Equal<HostCtx["ui"], TemplateCtx["ui"]> = true;
export const workspace: Equal<HostCtx["workspace"], TemplateCtx["workspace"]> = true;
export const assets: Equal<HostCtx["assets"], TemplateCtx["assets"]> = true;
export const exporters: Equal<HostCtx["exporters"], TemplateCtx["exporters"]> = true;
export const spellcheck: Equal<HostCtx["spellcheck"], TemplateCtx["spellcheck"]> = true;
export const settings: Equal<HostCtx["settings"], TemplateCtx["settings"]> = true;
export const markdown: Equal<
  MarkdownShape<HostCtx["markdown"]>,
  MarkdownShape<TemplateCtx["markdown"]>
> = true;
export const fencedLanguage: Equal<
  FencedLanguage<HostCtx["markdown"]>,
  FencedLanguage<TemplateCtx["markdown"]>
> = true;

export const commandContribution: Equal<Host.CommandContribution, Template.CommandContribution> =
  true;
export const mountContribution: Equal<Host.MountContribution, Template.MountContribution> = true;
export const sidebarPanelContribution: Equal<
  Host.SidebarPanelContribution,
  Template.SidebarPanelContribution
> = true;
export const exporterContribution: Equal<Host.ExporterContribution, Template.ExporterContribution> =
  true;
export const siteThemeContribution: Equal<
  Host.SiteThemeContribution,
  Template.SiteThemeContribution
> = true;
export const dictionaryContribution: Equal<
  Host.DictionaryContribution,
  Template.DictionaryContribution
> = true;
export const fileTypeContribution: Equal<Host.FileTypeContribution, Template.FileTypeContribution> =
  true;
export const fencedRendererProps: Equal<Host.FencedRendererProps, Template.FencedRendererProps> =
  true;
export const fencedRendererOptions: Equal<
  Host.FencedRendererOptions,
  Template.FencedRendererOptions
> = true;
export const fencedRendererMount: Equal<Host.FencedRendererMount, Template.FencedRendererMount> =
  true;
export const i18nApi: Equal<Host.I18nApi, Template.I18nApi> = true;

// activate's ctx parameter differs only through the markdown types checked above.
export const pluginModule: Equal<
  Omit<Host.PluginModule, "activate">,
  Omit<Template.PluginModule, "activate">
> = true;
export const activateReturn: Equal<
  ReturnType<Host.PluginModule["activate"]>,
  ReturnType<Template.PluginModule["activate"]>
> = true;
