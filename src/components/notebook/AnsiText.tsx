import { parseAnsi } from "@/lib/notebook/ansi";

interface AnsiTextProps {
  text: string;
  className?: string;
}

// Render text that may contain ANSI escape codes (stream output, tracebacks)
// as a <pre> with per-segment styling. Keys are byte offsets, which are stable
// and unique because segments never reorder.
export function AnsiText({ text, className }: AnsiTextProps) {
  const segments = parseAnsi(text);
  let offset = 0;
  return (
    <pre className={className}>
      {segments.map((seg) => {
        const key = `${offset}:${seg.text.length}`;
        offset += seg.text.length;
        return (
          <span
            key={key}
            className={seg.classes.length > 0 ? seg.classes.join(" ") : undefined}
            style={
              seg.style.color || seg.style.backgroundColor
                ? { color: seg.style.color, backgroundColor: seg.style.backgroundColor }
                : undefined
            }
          >
            {seg.text}
          </span>
        );
      })}
    </pre>
  );
}
