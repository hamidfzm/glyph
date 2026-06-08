import { type CSSProperties, useEffect, useRef, useState } from "react";

interface InlineRenameInputProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The text field shown in place of a tree row while naming a just-created note
 * or folder. Enter (or blur) commits the typed name; Escape cancels. A guard
 * ensures the commit/cancel callback fires exactly once, since Escape also
 * blurs the input as it unmounts.
 */
export function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
  className,
  style,
}: InlineRenameInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    // The input is rendered with this ref, so it's attached by the time the
    // mount effect runs.
    const el = ref.current as HTMLInputElement;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    onCommit(value);
  };

  const cancel = () => {
    if (finished.current) return;
    finished.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      className={className}
      style={style}
    />
  );
}
