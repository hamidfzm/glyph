import type { ContextMenuSubmenuItem } from "@/lib/contextMenuItems";
import { ActionButton } from "./ActionButton";
import { ITEM_CLASS, SURFACE_CLASS } from "./contextMenuStyles";

// A menu row that opens a nested panel of action items to its right. The parent
// owns the open/closed state so only one submenu is open at a time.
export function SubmenuItem({
  item,
  open,
  onToggle,
  onRun,
}: {
  item: ContextMenuSubmenuItem;
  open: boolean;
  onToggle: () => void;
  onRun: (onSelect: () => void) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={ITEM_CLASS}
        onClick={onToggle}
      >
        <span className="truncate">{item.label}</span>
        <span aria-hidden="true" className="opacity-60">
          ›
        </span>
      </button>
      {open && (
        <div role="menu" className={`absolute ${SURFACE_CLASS} top-0 start-full -mt-1 ms-1`}>
          {item.items.map((sub) => (
            <ActionButton key={sub.label} item={sub} onSelect={() => onRun(sub.onSelect)} />
          ))}
        </div>
      )}
    </div>
  );
}
