/// <reference types="vite/client" />

// Injected at build time from package.json (see vite.config.ts /
// vitest.config.ts `define`): `version`, and the `<name>@<version>` Sentry release.
declare const __APP_VERSION__: string;
declare const __SENTRY_RELEASE__: string;

declare module "*.css?inline" {
  const css: string;
  export default css;
}
