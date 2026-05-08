import { Children, type ComponentPropsWithoutRef, isValidElement, type ReactNode } from "react";

interface TaskListItemProps extends ComponentPropsWithoutRef<"li"> {
  // ReactMarkdown passes the source mdast node here; not in JSX intrinsic types.
  node?: { position?: { start?: { line?: number } } };
  onTaskToggle?: (line: number) => void;
}

// Replace the disabled checkbox react-markdown emits for `- [ ]`/`- [x]`
// items with a clickable one tied back to the source line so the parent
// can rewrite the markdown.
export function TaskListItem({ onTaskToggle, node, children, ...rest }: TaskListItemProps) {
  const isTask = typeof rest.className === "string" && rest.className.includes("task-list-item");
  if (!isTask) {
    return <li {...rest}>{children}</li>;
  }

  // mdast's listItem keeps source position; rehype passes it through on `node`.
  const line = node?.position?.start?.line;

  const kids = Children.toArray(children);
  let originalChecked = false;
  let originalInput: ReactNode | null = null;
  // The first child after any leading whitespace text is the auto-emitted
  // <input>. We replace just that node, preserving everything that follows.
  const tail: ReactNode[] = [];
  for (const child of kids) {
    if (
      !originalInput &&
      isValidElement<{ type?: string; checked?: boolean }>(child) &&
      child.props.type === "checkbox"
    ) {
      originalInput = child;
      originalChecked = !!child.props.checked;
      continue;
    }
    tail.push(child);
  }

  const handleChange = () => {
    if (line !== undefined) onTaskToggle?.(line);
  };

  return (
    <li {...rest}>
      {originalInput ? (
        <input
          type="checkbox"
          checked={originalChecked}
          onChange={handleChange}
          aria-label="Toggle task"
        />
      ) : null}
      {tail}
    </li>
  );
}
