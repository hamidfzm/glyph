import { type ReactNode, useEffect, useId, useRef } from "react";

interface PromptModalProps {
  title: string;
  message: string;
  onCancel: () => void;
  /** Footer buttons; the one marked `data-autofocus` takes focus on open. */
  actions: ReactNode;
  children: ReactNode;
}

/**
 * The frame of a blocking prompt: it takes focus, keeps Tab inside, hands focus
 * back when it closes, and cancels on Escape.
 */
export function PromptModal({ title, message, onCancel, actions, children }: PromptModalProps) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    /* c8 ignore next 2 -- both nodes exist whenever this effect runs */
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  // The prompt blocks what the user asked for, so keyboard focus stays inside
  // it; the app behind the overlay must not be reachable to make further edits.
  // The buttons are the only focusable elements, so the trap is a wrap-around.
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
    e.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current + (e.shiftKey ? -1 : 1);
    buttons[(next + buttons.length) % buttons.length].focus();
  };

  return (
    <div
      ref={dialogRef}
      className="settings-overlay prompt-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onKeyDown={trapTab}
    >
      <div className="settings-modal prompt-modal">
        <div className="settings-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="prompt-body">
          <p id={messageId}>{message}</p>
          {children}
        </div>
        <div className="settings-footer prompt-footer">{actions}</div>
      </div>
    </div>
  );
}
