import { useState, useEffect, useRef, useCallback } from "react";
import mermaid from "mermaid";

let idCounter = 0;

interface MermaidDiagramProps {
  code: string;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-diagram-${idCounter++}`);
  const [error, setError] = useState<string | null>(null);

  const isDark = useCallback(
    () => document.documentElement.classList.contains("dark"),
    [],
  );

  const renderDiagram = useCallback(async () => {
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark() ? "dark" : "default",
      });
      const { svg } = await mermaid.render(idRef.current, code);
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagram error");
    }
  }, [code, isDark]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      renderDiagram();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [renderDiagram]);

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-label">Failed to render diagram</div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="mermaid-diagram" />;
}
