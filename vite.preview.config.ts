import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The preview page (src/preview) for the Windows Explorer preview handler and
// the macOS Quick Look extension, built on its own so each can load it from
// disk. `pnpm build:preview-handler` and `pnpm build:quicklook` run this.
export default defineConfig({
  root: path.resolve(__dirname, "src/preview"),
  // Relative asset URLs: WebView2 serves the folder from a virtual host.
  base: "./",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-preview/web"),
    emptyOutDir: true,
  },
  esbuild: {
    drop: ["console", "debugger"],
  },
});
