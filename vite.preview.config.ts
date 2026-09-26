import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The Windows Explorer preview page (src/preview), built on its own so the
// preview handler DLL can load it from disk. `pnpm build:preview-handler` runs
// this and stages the output with the DLL in dist-preview/.
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
