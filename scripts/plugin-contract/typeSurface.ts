// Compiles only while glyph-md/plugin-template's types/glyph.d.ts declares the
// same plugin API as the host. Checked by the "Plugin contract" CI job:
//   tsc -p scripts/plugin-contract   (template checked out at .ecosystem/plugin-template)
// Each check is its own constant so a failure names the part that drifted.
import type * as Host from "@/lib/plugins/types";
import type * as Template from "glyph";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Methods are bivariant in their parameters, so a narrowed parameter still
// assigns; tuples are not, which is why signatures compare as [params, return].
type Signature<F> = F extends (...args: infer P) => infer R ? [P, R] : F;

type SameMembers<A, B> =
  Same<keyof A, keyof B> extends true
    ? Same<{ [K in keyof A & keyof B]-?: Same<Signature<A[K]>, Signature<B[K]>> }[keyof A & keyof B], true>
    : false;

// The template types markdown plugins and fenced renderers loosely so plugin
// authors need no React or unified types; only names and arity must match.
type Arity<T> = { [K in keyof T]: T[K] extends (...args: infer P) => unknown ? P["length"] : never };

type HostCtx = Host.GlyphPluginContext;
type TemplateCtx = Template.GlyphPluginContext;

export const contextMembers: Same<keyof HostCtx, keyof TemplateCtx> = true;
export const apiVersion: Same<HostCtx["apiVersion"], TemplateCtx["apiVersion"]> = true;
export const commands: SameMembers<HostCtx["commands"], TemplateCtx["commands"]> = true;
export const ui: SameMembers<HostCtx["ui"], TemplateCtx["ui"]> = true;
export const markdown: SameMembers<Arity<HostCtx["markdown"]>, Arity<TemplateCtx["markdown"]>> =
  true;
export const workspace: SameMembers<HostCtx["workspace"], TemplateCtx["workspace"]> = true;
export const assets: SameMembers<HostCtx["assets"], TemplateCtx["assets"]> = true;
export const exporters: SameMembers<HostCtx["exporters"], TemplateCtx["exporters"]> = true;
export const spellcheck: SameMembers<HostCtx["spellcheck"], TemplateCtx["spellcheck"]> = true;
export const settings: SameMembers<HostCtx["settings"], TemplateCtx["settings"]> = true;
export const notify: Same<Signature<HostCtx["notify"]>, Signature<TemplateCtx["notify"]>> = true;
export const registerTranslations: Same<
  Signature<HostCtx["registerTranslations"]>,
  Signature<TemplateCtx["registerTranslations"]>
> = true;

export const commandContribution: Same<Host.CommandContribution, Template.CommandContribution> =
  true;
export const mountContribution: Same<Host.MountContribution, Template.MountContribution> = true;
export const sidebarPanelContribution: Same<
  Host.SidebarPanelContribution,
  Template.SidebarPanelContribution
> = true;
export const exporterContribution: Same<Host.ExporterContribution, Template.ExporterContribution> =
  true;
export const siteThemeContribution: Same<
  Host.SiteThemeContribution,
  Template.SiteThemeContribution
> = true;
export const dictionaryContribution: Same<
  Host.DictionaryContribution,
  Template.DictionaryContribution
> = true;
// activate's ctx parameter is compared member by member above.
export const pluginModule: Same<keyof Host.PluginModule, keyof Template.PluginModule> = true;
