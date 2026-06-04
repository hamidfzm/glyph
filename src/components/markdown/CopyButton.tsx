import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon } from "../icons/CheckIcon";
import { CopyIcon } from "../icons/CopyIcon";

/**
 * Copy-to-clipboard button for code blocks. Shows a check icon for 2s after a
 * successful copy, then reverts.
 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      className={`code-copy-button${copied ? " copied" : ""}`}
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
