import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ContextMenuItem } from "@/lib/contextMenuItems";
import { ActionButton } from "./ActionButton";
import { ITEM_CLASS, SURFACE_CLASS } from "./contextMenuStyles";

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

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Each right-click produces a fresh menu object. Reset transient state and
  // position it in one layout effect (before paint) so the clamp isn't undone
  // by a later passive effect. Clamps the menu back inside the viewport once
  // its real size is known.
  useLayoutEffect(() => {
    if (!menu) return;
    setOpenSubmenu(null);
    let x = menu.x;
    let y = menu.y;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      if (x + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
        x = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
      }
      if (y + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
        y = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
      }
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
          className="-mx-1 my-1 border-0 border-t border-[var(--color-border)]"
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
                <ActionButton key={sub.label} item={sub} onSelect={() => run(sub.onSelect)} />
              ))}
            </div>
          )}
        </div>,
      );
      continue;
    }
    rendered.push(
      <ActionButton key={item.label} item={item} onSelect={() => run(item.onSelect)} />,
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
