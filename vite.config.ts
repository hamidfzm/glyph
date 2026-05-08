import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
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
