import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { runCspProbe, shippedCsp } from "./cspPage";

// Smoke test for the D2/CSP regression: the D2 engine runs in a blob-URL
// worker whose init calls `new Function(...)`, and WebKit enforces the page
// CSP inside that worker, so the shipped script-src must keep 'unsafe-eval'
// or every D2 render fails on Linux/macOS. This renders a real diagram with
// the real d2 bundle under the CSP read from tauri.conf.json.

const d2Bundle = readFileSync(
  new URL("../../../node_modules/@terrastruct/d2/dist/browser/index.js", import.meta.url),
  "utf-8",
);

const RUN_JS = `
import { D2 } from "/d2.js";
try {
  const d2 = new D2();
  const result = await d2.compile("x -> y", { themeID: 0 });
  const svg = await d2.render(result.diagram, { ...result.renderOptions, noXMLTag: true });
  document.title = svg.includes("<svg") ? "D2_OK" : "D2_FAIL: no svg in output";
} catch (err) {
  document.title = "D2_FAIL: " + (err instanceof Error ? err.message : String(err));
}
`;

function renderUnderCsp(page: Page, csp: string): Promise<string> {
  return runCspProbe(page, {
    csp,
    runJs: RUN_JS,
    files: { "/d2.js": { contentType: "text/javascript", body: d2Bundle } },
    titlePrefix: "D2_",
  });
}

test("D2 renders a diagram under the shipped CSP", async ({ page }) => {
  expect(await renderUnderCsp(page, shippedCsp)).toBe("D2_OK");
});

// Calibration: prove this harness actually enforces CSP in the D2 worker. If
// this stops failing, the positive test above has gone vacuous.
test("the harness catches a CSP whose script-src lacks 'unsafe-eval'", async ({ page }) => {
  expect(shippedCsp).toContain(" 'unsafe-eval'");
  const withoutEval = shippedCsp.replace(" 'unsafe-eval'", "");
  expect(await renderUnderCsp(page, withoutEval)).toMatch(/^D2_FAIL/);
});
