import "@/styles/app.css";
import "@/styles/highlight.css";
import "./preview.css";
import { type PreviewHost, startPreview } from "./startPreview";

// Present only inside WebView2, where the preview handler posts the document.
const host = (window as { chrome?: { webview?: PreviewHost } }).chrome?.webview;
const root = document.getElementById("preview");

if (host && root) {
  startPreview({
    root,
    host,
    darkQuery: window.matchMedia("(prefers-color-scheme: dark)"),
    language: navigator.language,
  });
}
