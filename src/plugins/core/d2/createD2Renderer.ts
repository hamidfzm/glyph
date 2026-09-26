import type { FencedRendererMount, I18nApi } from "@/lib/plugins/types";
import { renderD2 } from "./d2Render";
import { svgToDataUrl } from "./svgDataUrl";

export const D2_NAMESPACE = "glyph.core.d2";

// The app's theme is the `.dark` class on <html>, which settings can set
// against the OS preference, so the media query is not the source of truth.
function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** Draws ```d2 blocks as diagrams, framework-free, through the public plugin API. */
export function createD2Renderer(i18n: I18nApi): FencedRendererMount {
  const t = (key: string) => i18n.t(`${D2_NAMESPACE}:${key}`);

  return {
    mount(el, { code, openLightbox }, registerCleanup) {
      const diagram = document.createElement("div");
      diagram.className = "d2-diagram";

      const failure = document.createElement("div");
      failure.className = "d2-error";
      const failureTitle = document.createElement("div");
      failureTitle.className = "d2-error-label";
      const source = document.createElement("code");
      source.textContent = code;
      const pre = document.createElement("pre");
      pre.append(source);
      failure.append(failureTitle, pre);

      let svg = "";
      let dark = isDark();
      // A theme flip starts a newer render while an older one may still be
      // compiling; only the newest may touch the DOM.
      let renderSeq = 0;

      // `el` keeps whatever it shows (the previous render, after a source edit)
      // until the new result is in; aria-busy holds export readiness meanwhile.
      const show = (content: HTMLElement) => {
        el.replaceChildren(content);
        el.setAttribute("aria-busy", "false");
      };

      const render = async () => {
        const seq = ++renderSeq;
        if (code.trim().length === 0) {
          show(failure);
          return;
        }
        el.setAttribute("aria-busy", "true");
        try {
          const rendered = await renderD2(code, dark);
          if (seq !== renderSeq) return;
          svg = rendered;
          diagram.innerHTML = rendered;
          show(diagram);
        } catch {
          if (seq !== renderSeq) return;
          show(failure);
        }
      };

      const applyLabels = () => {
        failureTitle.textContent = t("errorTitle");
        if (openLightbox) {
          diagram.title = t("zoomHint");
          diagram.setAttribute("aria-label", t("label"));
        }
      };

      if (openLightbox) {
        // The diagram is only on screen once an SVG is in.
        const zoom = () => openLightbox(svgToDataUrl(svg), t("label"));
        diagram.setAttribute("role", "button");
        diagram.tabIndex = 0;
        diagram.addEventListener("click", zoom);
        diagram.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            zoom();
          }
        });
      }

      const themeObserver = new MutationObserver(() => {
        if (isDark() === dark) return;
        dark = isDark();
        void render();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      applyLabels();
      registerCleanup(i18n.onLanguageChange(applyLabels));
      registerCleanup(() => {
        themeObserver.disconnect();
        renderSeq++;
        el.removeAttribute("aria-busy");
      });
      void render();
    },
  };
}
