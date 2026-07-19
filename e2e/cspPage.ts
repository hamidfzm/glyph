import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const conf = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf-8"),
);

/** The production CSP as shipped in tauri.conf.json. */
export const shippedCsp: string = conf.app.security.csp;

// Synthetic origins; page.route intercepts before DNS so nothing is fetched.
export const ORIGIN = "http://glyph-csp-smoke.test";
export const REMOTE = "https://glyph-remote-smoke.test";

interface CspProbeOptions {
  csp: string;
  /** Module script that runs the probe and reports into document.title. */
  runJs: string;
  /** Extra routed files, keyed by absolute pathname (e.g. "/d2.js"). */
  files?: Record<string, { contentType: string; body: string | Buffer }>;
  /** Markup inserted before the probe script. */
  bodyHtml?: string;
  /** The title prefix the probe reports with (e.g. "D2_"). */
  titlePrefix: string;
}

// The probe script is served as a separate file: the CSP under test has no
// 'unsafe-inline' in script-src (the real app loads scripts via 'self' too),
// so an inline <script> would be blocked before the probe ever ran.
export async function runCspProbe(page: Page, opts: CspProbeOptions): Promise<string> {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${opts.csp}">
</head>
<body>
${opts.bodyHtml ?? ""}
<script type="module" src="/run.js"></script>
</body>
</html>`;

  const files: Record<string, { contentType: string; body: string | Buffer }> = {
    "/run.js": { contentType: "text/javascript", body: opts.runJs },
    ...opts.files,
  };
  for (const origin of [ORIGIN, REMOTE]) {
    await page.route(`${origin}/**`, (route) => {
      const url = new URL(route.request().url());
      const file = files[url.pathname];
      if (file) {
        return route.fulfill({ contentType: file.contentType, body: file.body });
      }
      return route.fulfill({ contentType: "text/html", body: html });
    });
  }
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction((prefix) => document.title.startsWith(prefix), opts.titlePrefix);
  return page.title();
}
