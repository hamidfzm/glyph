import { i18n } from "@/lib/i18n";
import { localeDir, resolveLocale } from "@/lib/locales";
import { type HostMessage, parseHostMessage } from "./hostMessage";
import { renderPreview } from "./renderPreview";

/** How the host (WebView2 on Windows, Quick Look on macOS) reaches the page: previewHost.ts. */
export interface PreviewHost {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** A host's message, or from the web viewer a document with no folder behind it or a link it could not decode. */
export type PreviewMessage =
  | HostMessage
  | { kind: "document"; content: string; baseUrl: null }
  | { kind: "invalidLink" };

export interface StartPreviewOptions {
  root: HTMLElement;
  /** Absent for the web viewer, which calls `show` itself. */
  host?: PreviewHost;
  darkQuery: MediaQueryList;
  language: string;
}

export interface Preview {
  /** Render a message; null clears the root. */
  show(message: PreviewMessage | null): void;
  /** Settles once the page's translations have loaded. */
  ready: Promise<unknown>;
}

export function startPreview({ root, host, darkQuery, language }: StartPreviewOptions): Preview {
  const locale = resolveLocale(language);
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale);
  const ready = i18n.changeLanguage(locale);
  // Before the document arrives, so the pane is never light in dark mode.
  applyTheme(darkQuery);

  let current: PreviewMessage | null = null;
  let latestRender = 0;

  async function render() {
    const render = ++latestRender;
    const message = current;
    const dark = applyTheme(darkQuery);
    if (!message) {
      root.replaceChildren();
      return;
    }
    await ready;
    const node = await renderMessage(message, dark, locale).catch(() =>
      notice(i18n.t("preview.failed")),
    );
    // A theme switch mid-render starts a newer one; the older result is stale.
    if (render === latestRender) root.replaceChildren(node);
  }

  function show(message: PreviewMessage | null) {
    current = message;
    void render();
  }

  host?.addEventListener("message", (event) => {
    const message = parseHostMessage(event.data);
    if (message) show(message);
  });
  // Mermaid bakes the theme into its SVG, so a theme switch re-renders.
  darkQuery.addEventListener("change", () => void render());
  return { show, ready };
}

async function renderMessage(message: PreviewMessage, dark: boolean, locale: string) {
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
    case "invalidLink":
      return notice(i18n.t("preview.invalidLink"));
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
