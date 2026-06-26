import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLightbox } from "@/contexts/LightboxContext";
import { useIsDarkMode } from "@/hooks/useIsDarkMode";
import { svgToDataUrl } from "@/lib/svgDataUrl";

let idCounter = 0;
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

interface MermaidDiagramProps {
  code: string;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const { t } = useTranslation("common");
  const containerRef = useRef<HTMLDivElement>(null);
  // Last rendered SVG markup, so a click can open it zoomable in the lightbox.
  const svgRef = useRef<string>("");
  // Sentinel that lets us drop stale render results. Each call bumps it; if
  // the call finishes and the sentinel has since changed, a newer render is
  // in flight and we leave the DOM alone.
  const renderSeqRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const isDark = useIsDarkMode();
  const lightbox = useLightbox();

  const renderDiagram = useCallback(async () => {
    const mySeq = ++renderSeqRef.current;
    if (code.trim().length === 0) {
      setError(t("mermaid.empty"));
      return;
    }
    // Always pass a fresh id to `mermaid.render`. Mermaid v11 keeps internal
    // state keyed by id, and calling render twice with the same id (React
    // double-mount, theme flip, parent re-render) makes the second call
    // return a tiny ~5KB stub SVG that paints as a blank preview.
    const id = `mermaid-diagram-${idCounter++}`;
    try {
      const mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
      });
      const { svg } = await mermaid.render(id, code);
      if (renderSeqRef.current !== mySeq) return;
      svgRef.current = svg;
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
        setError(null);
      }
    } catch (err) {
      if (renderSeqRef.current !== mySeq) return;
      setError(err instanceof Error ? err.message : t("mermaid.errorLabel"));
    }
  }, [code, isDark, t]);

  const openInLightbox = useCallback(() => {
    if (lightbox && svgRef.current) {
      lightbox.openSrc(svgToDataUrl(svgRef.current), t("mermaid.label"));
    }
  }, [lightbox, t]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-label">{t("mermaid.errorTitle")}</div>
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
      className="mermaid-diagram"
      data-mermaid-source={code}
      {...(lightbox
        ? {
            role: "button",
            tabIndex: 0,
            title: t("mermaid.zoomHint"),
            "aria-label": t("mermaid.label"),
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
