import { useCallback, useEffect, useRef, useState } from "react";
import type { TocEntry } from "../../hooks/useTableOfContents";

interface SidebarProps {
  entries: TocEntry[];
  visible: boolean;
  width?: number;
}

export function Sidebar({ entries, visible, width }: SidebarProps) {
  const [activeId, setActiveId] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current?.disconnect();

    if (entries.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (intersections) => {
        for (const entry of intersections) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-20px 0px -60% 0px", threshold: 0.1 },
    );

    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [entries]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (!visible || entries.length === 0) return null;

  return (
    <nav
      data-print-hide="true"
      className="shrink-0 overflow-y-auto border-r border-[var(--color-border)] select-none pt-3"
      style={{
        width: width ?? 224,
        background: "var(--glyph-sidebar-bg)",
      }}
    >
      <div className="px-3 pb-3">
        <h3 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2 px-2">
          Contents
        </h3>
        <ul className="space-y-0.5">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => scrollTo(entry.id)}
                className={`w-full text-left text-sm py-1 px-2 rounded-[var(--glyph-radius-sm)] truncate transition-colors ${
                  activeId === entry.id
                    ? "bg-[var(--color-accent)] text-white font-medium"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
                }`}
                style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
                title={entry.text}
              >
                {entry.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
