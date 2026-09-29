import "@/styles/app.css";
import "@/styles/highlight.css";
import "@/plugins/core/mermaid/mermaid.css";
import "./preview.css";
import { connectHost } from "./previewHost";
import { startPreview } from "./startPreview";

const { host, platform } = connectHost(window);
document.documentElement.dataset.platform = platform;
const root = document.getElementById("preview");

if (root) {
  startPreview({
    root,
    host,
    darkQuery: window.matchMedia("(prefers-color-scheme: dark)"),
    language: navigator.language,
  });
}
