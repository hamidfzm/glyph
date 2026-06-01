/// <reference types="vite/client" />

// Injected at build time from package.json `version` (see vite.config.ts /
// vitest.config.ts `define`). Used as the Sentry release identifier.
declare const __APP_VERSION__: string;

declare module "*.css?inline" {
  const css: string;
  export default css;
}
