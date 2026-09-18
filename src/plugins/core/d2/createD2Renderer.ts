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
      // Holds export readiness until the SVG (or the failure) is in.
      diagram.setAttribute("aria-busy", "true");

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

      const fail = () => {
        diagram.setAttribute("aria-busy", "false");
        el.replaceChildren(failure);
      };

      const render = async () => {
        const seq = ++renderSeq;
        if (code.trim().length === 0) {
          fail();
          return;
        }
        diagram.setAttribute("aria-busy", "true");
        try {
          const rendered = await renderD2(code, dark);
          if (seq !== renderSeq) return;
          svg = rendered;
          diagram.innerHTML = rendered;
          diagram.setAttribute("aria-busy", "false");
          el.replaceChildren(diagram);
        } catch {
          if (seq !== renderSeq) return;
          fail();
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
        const zoom = () => {
          if (svg) openLightbox(svgToDataUrl(svg), t("label"));
        };
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
      });
      el.replaceChildren(diagram);
      void render();
    },
  };
}
