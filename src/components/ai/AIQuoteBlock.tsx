import { type ComponentPropsWithoutRef, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { locateInDocument } from "@/lib/documentHighlight";

const MISS_FEEDBACK_MS = 1500;

// Blockquote renderer for assistant messages. The system prompt asks the
// model to quote the document verbatim in blockquotes, so each one gets a
// button that scrolls the viewer to the quoted passage and flashes it.
export function AIQuoteBlock({ children, ...props }: ComponentPropsWithoutRef<"blockquote">) {
  const { t } = useTranslation("ai");
  const ref = useRef<HTMLQuoteElement>(null);
  const [missed, setMissed] = useState(false);

  const handleLocate = useCallback(() => {
    const text = ref.current?.textContent ?? "";
    if (!locateInDocument(text)) {
      setMissed(true);
      window.setTimeout(() => setMissed(false), MISS_FEEDBACK_MS);
    }
  }, []);

  return (
    <blockquote {...props} ref={ref} className="ai-quote">
      {children}
      <button type="button" className="ai-quote-locate" onClick={handleLocate}>
        {missed ? t("locateMissed") : t("locate")}
      </button>
    </blockquote>
  );
}
