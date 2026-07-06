import { type ComponentPropsWithoutRef, type MouseEvent, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { locateInDocument } from "@/lib/documentHighlight";

const MISS_FEEDBACK_MS = 1500;

// Blockquote renderer for assistant messages. The system prompt asks the
// model to quote the document verbatim in blockquotes, so each one gets a
// button that scrolls the viewer to the quoted passage and flashes it.
export function AIQuoteBlock({ children, ...props }: ComponentPropsWithoutRef<"blockquote">) {
  const { t } = useTranslation("ai");
  const [missed, setMissed] = useState(false);

  const handleLocate = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // The quote text is read from the content wrapper, not the blockquote,
    // so the button's own label never leaks into the searched passage. The
    // wrapper always directly precedes the button.
    const content = event.currentTarget.previousElementSibling as HTMLElement;
    if (!locateInDocument(content.textContent ?? "")) {
      setMissed(true);
      window.setTimeout(() => setMissed(false), MISS_FEEDBACK_MS);
    }
  }, []);

  return (
    <blockquote {...props} className="ai-quote">
      <div className="ai-quote-content">{children}</div>
      <button type="button" className="ai-quote-locate" onClick={handleLocate}>
        {missed ? t("locateMissed") : t("locate")}
      </button>
    </blockquote>
  );
}
