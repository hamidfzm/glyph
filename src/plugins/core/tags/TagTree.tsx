import type { TagNode } from "./buildTagTree";
import { TagChip } from "./TagChip";

interface TagTreeProps {
  nodes: TagNode[];
  selected: string | null;
  filterLabel: (tag: string) => string;
  onSelect: (tag: string | null) => void;
}

// Nested tags hang under their parent on their own row; a level with no
// nesting stays the wrapping chip cloud it was.
export function TagTree({ nodes, selected, filterLabel, onSelect }: TagTreeProps) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {nodes.map((node) => (
        <li key={node.tag} className={node.children.length > 0 ? "w-full" : undefined}>
          <TagChip
            tag={node.tag}
            label={node.label}
            count={node.count}
            selected={selected === node.tag}
            filterLabel={filterLabel}
            onSelect={onSelect}
          />
          {node.children.length > 0 && (
            <div className="mt-1.5 ms-2 ps-2 border-s border-[var(--color-border)]">
              <TagTree
                nodes={node.children}
                selected={selected}
                filterLabel={filterLabel}
                onSelect={onSelect}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
