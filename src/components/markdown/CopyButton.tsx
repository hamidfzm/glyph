import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon } from "../icons/CheckIcon";
import { CopyIcon } from "../icons/CopyIcon";

/**
 * Copy-to-clipboard button for code blocks. Shows a check icon for 2s after a
 * successful copy, then reverts.
 */
export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation("common");
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
      aria-label={copied ? t("copyButton.copied") : t("copyButton.label")}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
