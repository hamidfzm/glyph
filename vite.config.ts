import { readFileSync } from "node:fs";
import path from "node:path";
import { codecovVitePlugin } from "@codecov/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

// Source-map upload is opt-in via the auth token (set in CI). Without it, the
// plugin is skipped entirely so local/dev builds are unaffected.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig(async ({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    codecovVitePlugin({
      enableBundleAnalysis: Boolean(process.env.CODECOV_TOKEN),
      bundleName: "glyph-frontend",
      uploadToken: process.env.CODECOV_TOKEN,
      gitService: "github",
    }),
    // Uploads source maps to Sentry so production stack traces are readable.
    // Only active when SENTRY_AUTH_TOKEN is present; maps are deleted from the
    // bundle after upload so they never ship to users.
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: "glyph-md",
            project: "glyph",
            authToken: sentryAuthToken,
            telemetry: false,
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],
  // Expose package.json versions to the app (Sentry release id, plugin API).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PLUGIN_API_VERSION__: JSON.stringify(pkg.pluginApi.version),
    __PLUGIN_API_COMPAT_FLOOR__: JSON.stringify(pkg.pluginApi.compatFloor),
  },
  // Source maps are only emitted when we're going to upload + delete them.
  build: {
    sourcemap: sentryAuthToken ? true : false,
    rollupOptions: {
      output: {
        // The `@terrastruct/d2` browser build resolves to its own `index.js`, so
        // its lazy chunk would otherwise be named `index-<hash>.js` and collide
        // with the entry chunk in bundle-size diffs. Give it a stable name; it
        // stays lazy (only the dynamic import in d2Render.ts references it).
        manualChunks(id) {
          if (id.includes("@terrastruct/d2")) return "d2";
        },
      },
    },
  },
  // Strip `console.*` and `debugger` from production bundles so diagnostic
  // logs added during debugging don't leak into shipped builds (and don't
  // weigh down the bundle). Dev builds keep them so the in-app DevTools
  // panel stays useful.
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Don't full-reload the dev webview when project content (Rust, demo
      // markdown, top-level docs) changes. Only source under `src/` and
      // editor config files should drive HMR. Without this, auto-save into
      // samples/README.md while testing wikilinks bounces the webview and
      // kills any in-flight UI state (autocomplete popup, cursor, etc.).
      ignored: [
        "**/src-tauri/**",
        "**/samples/**",
        "**/dist/**",
        "**/.github/**",
        "**/.claude/**",
        "**/docs/**",
        "**/*.md",
      ],
    },
  },
}) satisfies UserConfig);
