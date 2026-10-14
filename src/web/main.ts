import "@/styles/app.css";
import "@/styles/highlight.css";
import "@/plugins/core/math/math.css";
import "@/plugins/core/mermaid/mermaid.css";
import "@/preview/preview.css";
import "./web.css";
import { startWebViewer } from "./webViewer";

const root = document.getElementById("preview");

if (root) {
  void startWebViewer({
    root,
    darkQuery: window.matchMedia("(prefers-color-scheme: dark)"),
    language: navigator.language,
  });
}
