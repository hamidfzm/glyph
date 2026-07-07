import { describe, expect, it } from "vitest";
import { i18n, registerTranslations } from "./i18n";

describe("registerTranslations", () => {
  it("deep-merges plugin resources into an existing namespace", () => {
    registerTranslations("en", "common", { pluginKey: { greeting: "hello" } });
    expect(i18n.getResource("en", "common", "pluginKey.greeting")).toBe("hello");
    // Bundled keys survive the merge.
    expect(i18n.getResource("en", "common", "search.label")).toBe("Search");
  });

  it("registers a brand-new namespace", () => {
    registerTranslations("en", "my-plugin", { title: "My Plugin" });
    expect(i18n.getResource("en", "my-plugin", "title")).toBe("My Plugin");
  });
});
