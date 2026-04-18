import { useCallback } from "react";
import type { PrintSettings } from "../lib/settings";
import type { TocEntry } from "./useTableOfContents";

interface UsePrintOptions {
  entries: TocEntry[];
  settings: PrintSettings;
}

const TOC_CLASS = "print-toc";

function buildTocElement(entries: TocEntry[]): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = TOC_CLASS;
  nav.setAttribute("aria-label", "Table of contents");

  const heading = document.createElement("h2");
  heading.textContent = "Contents";
  nav.appendChild(heading);

  const list = document.createElement("ul");
  for (const entry of entries) {
    const li = document.createElement("li");
    li.style.paddingLeft = `${(entry.level - 1) * 16}px`;
    const a = document.createElement("a");
    a.href = `#${entry.id}`;
    a.textContent = entry.text;
    li.appendChild(a);
    list.appendChild(li);
  }
  nav.appendChild(list);
  return nav;
}

export function usePrint({ entries, settings }: UsePrintOptions) {
  return useCallback(() => {
    const body = document.querySelector<HTMLElement>(".markdown-body");
    if (!body) return;

    const root = document.documentElement;
    root.setAttribute("data-print-breaks", settings.pageBreakLevel);
    root.setAttribute("data-print-bg", String(settings.includeBackground));

    let injected: HTMLElement | null = null;
    if (settings.includeToc && entries.length > 0) {
      injected = buildTocElement(entries);
      body.insertBefore(injected, body.firstChild);
    }

    const cleanup = () => {
      root.removeAttribute("data-print-breaks");
      root.removeAttribute("data-print-bg");
      if (injected?.parentNode) {
        injected.parentNode.removeChild(injected);
      }
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);
    window.print();
  }, [entries, settings.pageBreakLevel, settings.includeBackground, settings.includeToc]);
}
