import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLightbox } from "@/contexts/LightboxContext";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import { renderD2 } from "@/lib/d2Render";
import { svgToDataUrl } from "@/lib/svgDataUrl";

interface D2DiagramProps {
  code: string;
}

export function D2Diagram({ code }: D2DiagramProps) {
  const { t } = useTranslation("common");
  const containerRef = useRef<HTMLDivElement>(null);
  // Last rendered SVG markup, so a click can open it zoomable in the lightbox.
  const svgRef = useRef<string>("");
  // Sentinel that drops stale render results: each call bumps it; if the call
  // finishes after a newer one started, we leave the DOM to the newer render.
  const renderSeqRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const isDark = useIsDarkMode();
  const lightbox = useLightbox();

  const renderDiagram = useCallback(async () => {
    const mySeq = ++renderSeqRef.current;
    if (code.trim().length === 0) {
      setError(t("d2.empty"));
      return;
    }
    // Clear any prior error up front so the container div remounts before the
    // async render resolves; otherwise the error fallback keeps the container
    // unmounted and a successful re-render could never write its SVG.
    setError(null);
    try {
      const svg = await renderD2(code, isDark);
      if (renderSeqRef.current !== mySeq) return;
      svgRef.current = svg;
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
      }
    } catch (err) {
      if (renderSeqRef.current !== mySeq) return;
      setError(err instanceof Error ? err.message : t("d2.errorLabel"));
    }
  }, [code, isDark, t]);

  const openInLightbox = useCallback(() => {
    if (lightbox && svgRef.current) {
      lightbox.openSrc(svgToDataUrl(svgRef.current), t("d2.label"));
    }
  }, [lightbox, t]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  if (error) {
    return (
      <div className="d2-error">
        <div className="d2-error-label">{t("d2.errorTitle")}</div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  // The source is exposed so PDF export can re-render the diagram in a light
  // theme (the rendered SVG bakes in the app theme's colors). Clicking (or
  // Enter/Space) opens the diagram zoomable in the lightbox when one is in
  // scope (not during export/print, where the provider is absent).
  return (
    <div
      ref={containerRef}
      className="d2-diagram"
      data-d2-source={code}
      {...(lightbox
        ? {
            role: "button",
            tabIndex: 0,
            title: t("d2.zoomHint"),
            "aria-label": t("d2.label"),
            onClick: openInLightbox,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openInLightbox();
              }
            },
          }
        : {})}
    />
  );
}
