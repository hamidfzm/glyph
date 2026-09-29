import type { PreviewHost } from "./startPreview";

type Listener = (event: { data: unknown }) => void;

interface HostWindow {
  chrome?: { webview?: PreviewHost };
  glyphHost?: { post(data: unknown): void; messages?: unknown[] };
}

// Without WebView2's `chrome.webview` this is Quick Look, whose document-start
// stub queues posts until here (PreviewViewController.swift).
export function connectHost(win: Window): { host: PreviewHost; platform: "windows" | "macos" } {
  const target = win as HostWindow;
  const webview = target.chrome?.webview;
  if (webview) return { host: webview, platform: "windows" };

  const listeners: Listener[] = [];
  let queued = target.glyphHost?.messages ?? [];
  target.glyphHost = {
    post: (data) => {
      for (const listener of listeners) listener({ data });
    },
  };
  function addEventListener(_type: "message", listener: Listener) {
    listeners.push(listener);
    for (const data of queued) listener({ data });
    queued = [];
  }
  return { host: { addEventListener }, platform: "macos" };
}
