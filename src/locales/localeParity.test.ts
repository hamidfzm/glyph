import { describe, expect, it } from "vitest";

// Every locale must carry the exact key set English does, in every namespace.
// English is the source of truth: a key added there without its translations
// (or a stray key left behind in one locale) fails this test, so untranslated
// UI can't ship silently. See .claude/rules/i18n.md.
const bundles = import.meta.glob("./*/*.json", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

interface LocaleBundles {
  [locale: string]: { [namespace: string]: Record<string, unknown> };
}

const byLocale: LocaleBundles = {};
for (const [path, module] of Object.entries(bundles)) {
  const match = path.match(/^\.\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, locale, namespace] = match;
  byLocale[locale] ??= {};
  byLocale[locale][namespace] = (module.default ?? module) as Record<string, unknown>;
}

function flattenKeys(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === "object"
      ? flattenKeys(child as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const english = byLocale.en;
const otherLocales = Object.keys(byLocale)
  .filter((locale) => locale !== "en")
  .sort();

describe("locale parity", () => {
  it("has at least one non-English locale to compare", () => {
    expect(otherLocales.length).toBeGreaterThan(0);
  });

  for (const locale of otherLocales) {
    it(`${locale} mirrors every English namespace and key`, () => {
      expect(Object.keys(byLocale[locale]).sort()).toEqual(Object.keys(english).sort());
      for (const [namespace, bundle] of Object.entries(english)) {
        const enKeys = flattenKeys(bundle).sort();
        const locKeys = flattenKeys(byLocale[locale][namespace] ?? {}).sort();
        expect(locKeys, `${locale}/${namespace}.json`).toEqual(enKeys);
      }
    });
  }
});
