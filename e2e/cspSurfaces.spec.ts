import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { REMOTE, runCspProbe, shippedCsp } from "./cspPage";

// Every CSP-dependent render surface, probed under the shipped CSP. Each past
// regression here shipped as "feature silently broken in production only":
// runtime-injected styles (#390), remote document images (8e75230), the D2
// worker (#519).

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A real font, so document.fonts.check distinguishes "loaded" from "blocked
// by font-src" (a CSP-blocked font in WebKit fails silently, with neither a
// load error nor a securitypolicyviolation event to observe).
const FONT_BASE64 = readFileSync(
  new URL("../node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2", import.meta.url),
).toString("base64");

// The @font-face lives in an external stylesheet (allowed via style-src
// 'self'), not the inline <style>: the calibration test strips
// 'unsafe-inline', and killing the inline block must not unregister the font
// family, or fonts.check would report an unknown family as "available" and
// the font probe would go silent.
const BODY_HTML = `
<link rel="stylesheet" href="/probe.css">
<style>
#style-probe { color: rgb(1, 2, 3); }
</style>
<span id="style-probe" style="font-family: SmokeFont">probe</span>
`;

const PROBE_CSS = `@font-face { font-family: SmokeFont; src: url(data:font/woff2;base64,${FONT_BASE64}); }`;

const RUN_JS = `
const failures = [];

function loadImg(src, label) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(null);
    img.onerror = () => resolve(label + " image failed to load");
    img.src = src;
  });
}

const pngBytes = Uint8Array.from(atob("${PNG_BASE64}"), (c) => c.charCodeAt(0));
const blobUrl = URL.createObjectURL(new Blob([pngBytes], { type: "image/png" }));

const imgFailures = await Promise.all([
  loadImg("data:image/png;base64,${PNG_BASE64}", "data:"),
  loadImg(blobUrl, "blob:"),
  loadImg("${REMOTE}/img.png", "remote https:"),
]);
failures.push(...imgFailures.filter(Boolean));

// style-src 'unsafe-inline': both the parsed <style> block and a
// runtime-injected one, the surface #390 regressed.
if (getComputedStyle(document.getElementById("style-probe")).color !== "rgb(1, 2, 3)") {
  failures.push("inline <style> not applied");
}
const injected = document.createElement("style");
injected.textContent = "#style-probe { background-color: rgb(4, 5, 6); }";
document.head.appendChild(injected);
if (getComputedStyle(document.getElementById("style-probe")).backgroundColor !== "rgb(4, 5, 6)") {
  failures.push("runtime-injected style not applied");
}

// script-src blob:, the plugin sandbox worker surface. A classic worker is
// enough; the D2 spec covers module workers and eval.
const workerResult = await new Promise((resolve) => {
  const worker = new Worker(
    URL.createObjectURL(new Blob(["postMessage('pong')"], { type: "text/javascript" })),
  );
  worker.onmessage = () => resolve(null);
  worker.onerror = () => resolve("blob worker failed to start");
  setTimeout(() => resolve("blob worker timed out"), 5000);
});
if (workerResult) failures.push(workerResult);

// connect-src https:, the AI-provider/marketplace surface.
try {
  await fetch("${REMOTE}/ping");
} catch {
  failures.push("fetch to remote https: blocked");
}

// font-src data:. Read the face's status rather than fonts.check(): WebKit
// reports check() true even when CSP blocked the load and the face errored.
await document.fonts.load("16px SmokeFont").catch(() => {});
const face = [...document.fonts].find((f) => f.family === "SmokeFont");
if (!face || face.status !== "loaded") {
  failures.push("data: font failed to load (" + (face ? face.status : "missing") + ")");
}

document.title = failures.length ? "CSP_FAIL: " + failures.join(" | ") : "CSP_OK";
`;

const FILES = {
  "/img.png": { contentType: "image/png", body: Buffer.from(PNG_BASE64, "base64") },
  "/ping": { contentType: "text/plain", body: "pong" },
  "/probe.css": { contentType: "text/css", body: PROBE_CSS },
};

function probe(page: Page, csp: string): Promise<string> {
  return runCspProbe(page, {
    csp,
    runJs: RUN_JS,
    bodyHtml: BODY_HTML,
    files: FILES,
    titlePrefix: "CSP_",
  });
}

test("images, styles, fonts, workers, and remote fetch work under the shipped CSP", async ({
  page,
}) => {
  expect(await probe(page, shippedCsp)).toBe("CSP_OK");
});

// Calibration: strip one source from each probed directive and assert every
// probe reports its failure, proving none of them passes vacuously.
test("the harness catches a CSP tightened on each probed directive", async ({ page }) => {
  const removals: Record<string, string> = {
    "img-src": " data:",
    "style-src": " 'unsafe-inline'",
    "script-src": " blob:",
    "font-src": " data:",
  };
  const directives = shippedCsp.split(";").map((d) => d.trim());
  const tightened = directives
    .map((d) => {
      const source = removals[d.split(" ")[0]];
      if (!source) return d;
      expect(d).toContain(source);
      return d.replace(source, "");
    })
    .join("; ");

  const title = await probe(page, tightened);
  expect(title).toContain("data: image failed to load");
  expect(title).toContain("inline <style> not applied");
  expect(title).toContain("blob worker");
  expect(title).toContain("data: font failed to load");
});
