import { defineConfig, devices } from "@playwright/test";

// WebKit only: this suite guards WebKit-specific behavior (WebKitGTK on Linux,
// WKWebView on macOS enforce the page CSP inside blob workers; Chromium does
// not, so it would pass even when the app is broken on WebKit platforms).
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
});
