import { i18n } from "@/lib/i18n";
import { localeDir, resolveLocale } from "@/lib/locales";
import { type HostMessage, parseHostMessage } from "./hostMessage";
import type { PickedImages } from "./previewImages";
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
  /**
   * Render a message, taking the relative images of a document with no folder
   * from `picked`; null clears the root. Settles once it is on screen with how
   * many relative images became alt text, or with null if another `show`
   * replaced it first.
   */
  show(message: PreviewMessage | null, picked?: PickedImages): Promise<number | null>;
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
  let currentPicked: PickedImages | null = null;
  let latestRender = 0;
  let settleShown: (droppedImages: number | null) => void = () => {};

  async function render() {
    const render = ++latestRender;
    const message = current;
    const picked = currentPicked;
    const dark = applyTheme(darkQuery);
    if (!message) {
      root.replaceChildren();
      settleShown(0);
      return;
    }
    await ready;
    const rendered = await renderMessage(message, dark, locale, picked).catch(() => ({
      node: notice(i18n.t("preview.failed")),
      droppedImages: 0,
    }));
    // A theme switch mid-render starts a newer one; the older result is stale.
    if (render !== latestRender) return;
    root.replaceChildren(rendered.node);
    settleShown(rendered.droppedImages);
  }

  function show(message: PreviewMessage | null, picked?: PickedImages) {
    settleShown(null);
    current = message;
    currentPicked = picked ?? null;
    const shown = new Promise<number | null>((resolve) => {
      settleShown = resolve;
    });
    void render();
    return shown;
  }

  host?.addEventListener("message", (event) => {
    const message = parseHostMessage(event.data);
    if (message) void show(message);
  });
  // Mermaid bakes the theme into its SVG, so a theme switch re-renders.
  darkQuery.addEventListener("change", () => void render());
  return { show, ready };
}

async function renderMessage(
  message: PreviewMessage,
  dark: boolean,
  locale: string,
  picked: PickedImages | null,
) {
  if (message.kind !== "document") {
    return { node: notice(noticeText(message, locale)), droppedImages: 0 };
  }
  const article = document.createElement("article");
  article.className = "markdown-body";
  article.dir = "auto";
  const { html, droppedImages } = await renderPreview(message.content, {
    dark,
    images: message.baseUrl ?? picked,
  });
  article.innerHTML = html;
  return { node: article, droppedImages };
}

function noticeText(
  message: Exclude<PreviewMessage, { kind: "document" }>,
  locale: string,
): string {
  switch (message.kind) {
    case "tooLarge": {
      const size = new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "megabyte",
        maximumFractionDigits: 1,
      }).format(message.bytes / (1024 * 1024));
      return i18n.t("preview.tooLarge", { size });
    }
    case "unreadable":
      return i18n.t("preview.unreadable");
    case "invalidLink":
      return i18n.t("preview.invalidLink");
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
