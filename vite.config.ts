import path from "node:path";
import { codecovVitePlugin } from "@codecov/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

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
  ],
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
}));
