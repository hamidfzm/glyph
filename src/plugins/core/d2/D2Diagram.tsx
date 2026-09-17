import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FencedRendererProps } from "@/lib/plugins/types";
import { renderD2 } from "./d2Render";
import { svgToDataUrl } from "./svgDataUrl";
import { useDarkClass } from "./useDarkClass";

export function D2Diagram({ code, openLightbox }: FencedRendererProps) {
  const { t } = useTranslation("d2");
  const containerRef = useRef<HTMLDivElement>(null);
  // Last rendered SVG markup, so a click can open it zoomable in the lightbox.
  const svgRef = useRef<string>("");
  // Sentinel that drops stale render results: each call bumps it; if the call
  // finishes after a newer one started, we leave the DOM to the newer render.
  const renderSeqRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  // aria-busy holds export readiness until the SVG (or the error) is in.
  const [busy, setBusy] = useState(true);
  const isDark = useDarkClass();

  const renderDiagram = useCallback(async () => {
    const mySeq = ++renderSeqRef.current;
    if (code.trim().length === 0) {
      setError(t("empty"));
      setBusy(false);
      return;
    }
    // Clear any prior error up front so the container div remounts before the
    // async render resolves; otherwise the error fallback keeps the container
    // unmounted and a successful re-render could never write its SVG.
    setError(null);
    setBusy(true);
    try {
      const svg = await renderD2(code, isDark);
      if (renderSeqRef.current !== mySeq) return;
      svgRef.current = svg;
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
      }
      setBusy(false);
    } catch (err) {
      if (renderSeqRef.current !== mySeq) return;
      setError(err instanceof Error ? err.message : t("errorLabel"));
      setBusy(false);
    }
  }, [code, isDark, t]);

  const zoom = useCallback(() => {
    if (openLightbox && svgRef.current) {
      openLightbox(svgToDataUrl(svgRef.current), t("label"));
    }
  }, [openLightbox, t]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  if (error) {
    return (
      <div className="d2-error">
        <div className="d2-error-label">{t("errorTitle")}</div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  // Clicking (or Enter/Space) opens the diagram zoomable when the host offers
  // a lightbox (not during export or print).
  return (
    <div
      ref={containerRef}
      className="d2-diagram"
      aria-busy={busy}
      {...(openLightbox
        ? {
            role: "button",
            tabIndex: 0,
            title: t("zoomHint"),
            "aria-label": t("label"),
            onClick: zoom,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                zoom();
              }
            },
          }
        : {})}
    />
  );
}
