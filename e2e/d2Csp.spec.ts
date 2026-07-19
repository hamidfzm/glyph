import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// Smoke test for the D2/CSP regression: the D2 engine runs in a blob-URL
// worker whose init calls `new Function(...)`, and WebKit enforces the page
// CSP inside that worker, so the shipped script-src must keep 'unsafe-eval'
// or every D2 render fails on Linux/macOS. This renders a real diagram with
// the real d2 bundle under the CSP read from tauri.conf.json.

const conf = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf-8"),
);
const shippedCsp: string = conf.app.security.csp;

const d2Bundle = readFileSync(
  new URL("../node_modules/@terrastruct/d2/dist/browser/index.js", import.meta.url),
  "utf-8",
);

// A synthetic origin; page.route intercepts before DNS so nothing is fetched.
const ORIGIN = "http://glyph-csp-smoke.test";

// The runner script is served as a separate file: the CSP under test has no
// 'unsafe-inline' in script-src (the real app loads scripts via 'self' too),
// so an inline <script> would be blocked before D2 ever ran.
function pageHtml(csp: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
</head>
<body>
<script type="module" src="/run.js"></script>
</body>
</html>`;
}

const runJs = `
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

async function renderUnderCsp(page: Page, csp: string): Promise<string> {
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/d2.js") {
      return route.fulfill({ contentType: "text/javascript", body: d2Bundle });
    }
    if (url.pathname === "/run.js") {
      return route.fulfill({ contentType: "text/javascript", body: runJs });
    }
    return route.fulfill({ contentType: "text/html", body: pageHtml(csp) });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.title.startsWith("D2_"));
  return page.title();
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
