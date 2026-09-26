import { i18n } from "@/lib/i18n";
import { localeDir, resolveLocale } from "@/lib/locales";
import { type HostMessage, parseHostMessage } from "./hostMessage";
import { renderPreview } from "./renderPreview";

/** WebView2's `window.chrome.webview`: how the preview handler reaches the page. */
export interface PreviewHost {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface StartPreviewOptions {
  root: HTMLElement;
  host: PreviewHost;
  darkQuery: MediaQueryList;
  language: string;
}

export function startPreview({ root, host, darkQuery, language }: StartPreviewOptions): void {
  const locale = resolveLocale(language);
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale);
  const translationsReady = i18n.changeLanguage(locale);
  // Before the document arrives, so the pane is never light in dark mode.
  applyTheme(darkQuery);

  let message: HostMessage | null = null;
  let latestRender = 0;

  async function show() {
    if (!message) return;
    const render = ++latestRender;
    const dark = applyTheme(darkQuery);
    await translationsReady;
    const node = await renderMessage(message, dark, locale).catch(() =>
      notice(i18n.t("preview.failed")),
    );
    // A theme switch mid-render starts a newer one; the older result is stale.
    if (render === latestRender) root.replaceChildren(node);
  }

  host.addEventListener("message", (event) => {
    message = parseHostMessage(event.data);
    void show();
  });
  // Mermaid bakes the theme into its SVG, so a theme switch re-renders.
  darkQuery.addEventListener("change", () => void show());
}

async function renderMessage(message: HostMessage, dark: boolean, locale: string) {
  switch (message.kind) {
    case "document": {
      const article = document.createElement("article");
      article.className = "markdown-body";
      article.dir = "auto";
      article.innerHTML = await renderPreview(message.content, { dark, baseUrl: message.baseUrl });
      return article;
    }
    case "tooLarge": {
      const size = new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "megabyte",
        maximumFractionDigits: 1,
      }).format(message.bytes / (1024 * 1024));
      return notice(i18n.t("preview.tooLarge", { size }));
    }
    case "unreadable":
      return notice(i18n.t("preview.unreadable"));
  }
}

function applyTheme(darkQuery: MediaQueryList): boolean {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
  return darkQuery.matches;
}

function notice(text: string): HTMLElement {
  const paragraph = document.createElement("p");
  paragraph.className = "preview-notice";
  paragraph.textContent = text;
  return paragraph;
}
