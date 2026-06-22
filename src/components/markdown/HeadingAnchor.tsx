import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons/CheckIcon";
import { LinkIcon } from "@/components/icons/LinkIcon";

/**
 * Hover-revealed button next to a heading that copies the heading's in-document
 * anchor (`#<id>`) to the clipboard. Shows a check icon for 2s after a
 * successful copy, then reverts. Mirrors CopyButton's interaction, but copies an
 * anchor rather than code and carries its own label/icon set.
 */
export function HeadingAnchor({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(`#${id}`)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard can reject when permission is denied; leave the button in
        // its idle state rather than surfacing an error for a copy affordance.
      });
  }, [id]);

  return (
    <button
      type="button"
      className={`heading-anchor${copied ? " copied" : ""}`}
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy link to heading"}
    >
      {copied ? <CheckIcon /> : <LinkIcon />}
    </button>
  );
}
