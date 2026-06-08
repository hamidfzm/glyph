import type { ContextMenuActionItem } from "@/lib/contextMenuItems";
import { ITEM_CLASS } from "./contextMenuStyles";

// A single clickable row in the context menu: optional leading icon, label, and
// a red tint for destructive (danger) actions.
export function ActionButton({
  item,
  onSelect,
}: {
  item: ContextMenuActionItem;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${ITEM_CLASS}${item.danger ? " text-[#e5484d]" : ""}`}
      onClick={onSelect}
    >
      <span className="flex items-center gap-2.5 truncate">
        {item.icon && <span className="opacity-80">{item.icon}</span>}
        <span className="truncate">{item.label}</span>
      </span>
    </button>
  );
}
