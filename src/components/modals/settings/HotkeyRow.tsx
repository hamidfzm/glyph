import { useEffect, useState } from "react";
import type { Platform } from "@/hooks/usePlatform";
import { acceleratorFromEvent, type BindableCommand, formatAccelerator } from "@/lib/keybindings";

interface HotkeyRowProps {
  command: BindableCommand;
  accelerator: string;
  platform: Platform;
  isOverridden: boolean;
  isConflict: boolean;
  onRecord: (accelerator: string) => void;
  onReset: () => void;
}

// One command row in the Hotkeys pane: shows the current binding, captures a new
// one when recording, and offers a reset when the binding has been overridden.
export function HotkeyRow({
  command,
  accelerator,
  platform,
  isOverridden,
  isConflict,
  onRecord,
  onReset,
}: HotkeyRowProps) {
  const [recording, setRecording] = useState(false);

  // While recording, swallow the next modifier+key combo and store it. Escape
  // cancels; a bare key (no Cmd/Ctrl/Alt) is ignored so shortcuts stay distinct
  // from typing.
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setRecording(false);
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey) return;
      const next = acceleratorFromEvent(event);
      if (next) {
        onRecord(next);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onRecord]);

  return (
    <div className="settings-row">
      <div>
        <span className="settings-label">{command.label}</span>
        {isConflict && (
          <div className="settings-description" style={{ color: "#e5484d" }}>
            Conflicts with another shortcut
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => setRecording((r) => !r)}
          aria-label={
            recording
              ? `Recording shortcut for ${command.label}`
              : `Change shortcut for ${command.label}`
          }
          style={{
            minWidth: 96,
            padding: "4px 10px",
            borderRadius: "var(--glyph-radius-sm)",
            border: `1px solid ${isConflict ? "#e5484d" : "var(--color-border)"}`,
            background: recording ? "var(--color-accent)" : "var(--color-surface-secondary)",
            color: recording ? "#fff" : "var(--color-text-primary)",
            fontFamily: "var(--glyph-code-font, ui-monospace, monospace)",
            fontSize: 12,
          }}
        >
          {recording ? "Press keys…" : formatAccelerator(accelerator, platform)}
        </button>
        {isOverridden && (
          <button
            type="button"
            onClick={onReset}
            title="Reset to default"
            aria-label={`Reset shortcut for ${command.label}`}
            className="settings-description"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
