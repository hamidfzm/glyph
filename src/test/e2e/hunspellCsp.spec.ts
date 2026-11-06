import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { runCspProbe, shippedCsp } from "./cspPage";

// Smoke test for spell check: the Hunspell engine is WebAssembly that fetches
// and compiles its .wasm on first use, which the page CSP gates in WebKit. This
// checks a word with the real package under the CSP read from tauri.conf.json.

const PACKAGE = new URL("../../../node_modules/hunspell-wasm/", import.meta.url);
const MODULES = ["Hunspell.js", "Utilities.js", "WasmMemoryManager.js", "Utf8.js"];

const files: Record<string, { contentType: string; body: string | Buffer }> = {
  "/wasm/hunspell.js": {
    contentType: "text/javascript",
    body: readFileSync(new URL("wasm/hunspell.js", PACKAGE), "utf-8"),
  },
  "/wasm/hunspell.wasm": {
    contentType: "application/wasm",
    body: readFileSync(new URL("wasm/hunspell.wasm", PACKAGE)),
  },
};
for (const name of MODULES) {
  files[`/dist/${name}`] = {
    contentType: "text/javascript",
    body: readFileSync(new URL(`dist/${name}`, PACKAGE), "utf-8"),
  };
}

const RUN_JS = `
import { createHunspellFromStrings } from "/dist/Hunspell.js";
try {
  const hunspell = await createHunspellFromStrings("SET UTF-8\\n", "1\\nhello\\n");
  const right = hunspell.testSpelling("hello") && !hunspell.testSpelling("helo");
  document.title = right ? "HUNSPELL_OK" : "HUNSPELL_FAIL: wrong answers";
} catch (err) {
  document.title = "HUNSPELL_FAIL: " + (err instanceof Error ? err.message : String(err));
}
`;

function checkUnderCsp(page: Page, csp: string): Promise<string> {
  return runCspProbe(page, { csp, runJs: RUN_JS, files, titlePrefix: "HUNSPELL_" });
}

test("Hunspell checks a word under the shipped CSP", async ({ page }) => {
  expect(await checkUnderCsp(page, shippedCsp)).toBe("HUNSPELL_OK");
});

// Calibration: prove this harness enforces CSP on WebAssembly. If this stops
// failing, the positive test above has gone vacuous.
test("the harness catches a CSP that allows no WebAssembly compile", async ({ page }) => {
  expect(shippedCsp).toContain(" 'wasm-unsafe-eval'");
  expect(shippedCsp).toContain(" 'unsafe-eval'");
  const withoutWasm = shippedCsp.replace(" 'wasm-unsafe-eval'", "").replace(" 'unsafe-eval'", "");
  expect(await checkUnderCsp(page, withoutWasm)).toMatch(/^HUNSPELL_FAIL/);
});
