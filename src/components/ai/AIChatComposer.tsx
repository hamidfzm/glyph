import { type ChangeEvent, type KeyboardEvent, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SendIcon } from "@/components/icons/SendIcon";
import { StopIcon } from "@/components/icons/StopIcon";

const MAX_TEXTAREA_HEIGHT = 120;

interface AIChatComposerProps {
  streaming: boolean;
  disabled?: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onStop: () => void;
}

// Chat input: Enter sends, Shift+Enter inserts a newline, the button flips to
// Stop while a reply is streaming. The textarea grows with its content up to a
// few lines.
export function AIChatComposer({
  streaming,
  disabled,
  placeholder,
  onSend,
  onStop,
}: AIChatComposerProps) {
  const { t } = useTranslation("ai");
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text);
    setValue("");
    // The textarea is mounted for as long as the composer is; submit only
    // fires from its own key handler or the send button beside it.
    (textareaRef.current as HTMLTextAreaElement).style.height = "auto";
  }, [value, streaming, disabled, onSend]);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="ai-composer">
      <textarea
        ref={textareaRef}
        className="ai-composer-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {streaming ? (
        <button
          type="button"
          className="ai-composer-btn"
          onClick={onStop}
          aria-label={t("stop")}
          title={t("stop")}
        >
          <StopIcon />
        </button>
      ) : (
        <button
          type="button"
          className="ai-composer-btn"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label={t("send")}
          title={t("send")}
        >
          <SendIcon />
        </button>
      )}
    </div>
  );
}
