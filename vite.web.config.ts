import path from "node:path";
import { mergeConfig } from "vite";
import previewConfig from "./vite.preview.config";

// The web viewer (src/web): the preview page in a browser, published by the
// glyph-md/view repo. `pnpm build:web` runs this.
export default mergeConfig(previewConfig, {
  root: path.resolve(__dirname, "src/web"),
  build: {
    outDir: path.resolve(__dirname, "dist-web"),
  },
});
