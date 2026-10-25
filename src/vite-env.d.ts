/// <reference types="vite/client" />

// Injected at build time from package.json (see vite.config.ts /
// vitest.config.ts `define`): `version`, the `<name>@<version>` Sentry release, and
// `homepage`.
declare const __APP_VERSION__: string;
declare const __SENTRY_RELEASE__: string;
declare const __HOMEPAGE__: string;

declare module "*.css?inline" {
  const css: string;
  export default css;
}
