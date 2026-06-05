import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ContextMenuItem } from "@/lib/contextMenuItems";

export interface ContextMenuModel {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  menu: ContextMenuModel | null;
  onClose: () => void;
}

const VIEWPORT_MARGIN = 4;

// A single in-app context menu, themed with the app's own fonts and CSS color
// variables so it matches the rest of the UI instead of the OS-native menu.
const SURFACE_CLASS =
  "fixed z-50 min-w-44 py-1 rounded-[var(--glyph-radius)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg text-sm text-[var(--color-text-primary)]";

const ITEM_CLASS =
  "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left hover:bg-[var(--color-surface-tertiary)] focus:bg-[var(--color-surface-tertiary)] focus:outline-none";

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Each right-click produces a fresh menu object; reset transient state and
  // seed the position from the click coordinates.
  useEffect(() => {
    setOpenSubmenu(null);
    if (menu) setPos({ x: menu.x, y: menu.y });
  }, [menu]);

  // Keep the menu inside the viewport once its real size is known.
  useLayoutEffect(() => {
    if (!menu || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      x = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    }
    if (y + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      y = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    }
    setPos({ x, y });
  }, [menu]);

  // Dismiss on outside press, Escape, scroll, resize, or window blur.
  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const run = (onSelect: () => void) => {
    onSelect();
    onClose();
  };

  const rendered: ReactNode[] = [];
  let separatorCount = 0;
  for (const item of menu.items) {
    if (item.kind === "separator") {
      separatorCount += 1;
      rendered.push(
        <hr
          key={`separator-${separatorCount}`}
          className="my-1 border-0 border-t border-[var(--color-border)]"
        />,
      );
      continue;
    }
    if (item.kind === "submenu") {
      const open = openSubmenu === item.label;
      rendered.push(
        <div key={item.label} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open}
            className={ITEM_CLASS}
            onClick={() => setOpenSubmenu(open ? null : item.label)}
          >
            <span className="truncate">{item.label}</span>
            <span aria-hidden="true" className="opacity-60">
              ›
            </span>
          </button>
          {open && (
            <div role="menu" className={`${SURFACE_CLASS} top-0 left-full -mt-1 ml-1`}>
              {item.items.map((sub) => (
                <button
                  key={sub.label}
                  type="button"
                  role="menuitem"
                  className={ITEM_CLASS}
                  onClick={() => run(sub.onSelect)}
                >
                  <span className="truncate">{sub.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>,
      );
      continue;
    }
    rendered.push(
      <button
        key={item.label}
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(item.onSelect)}
      >
        <span className="truncate">{item.label}</span>
      </button>,
    );
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-orientation="vertical"
      className={SURFACE_CLASS}
      style={{ top: pos.y, left: pos.x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {rendered}
    </div>
  );
}
