import { useCallback, useState } from "react";
import { usePlatform } from "@/hooks/usePlatform";
import { useSettings } from "@/hooks/useSettings";
import {
  BINDABLE_COMMANDS,
  type CommandCategory,
  findConflicts,
  resolveBindings,
} from "@/lib/keybindings";
import { HotkeyRow } from "./HotkeyRow";

const CATEGORY_ORDER: CommandCategory[] = ["File", "Edit", "View", "Application"];

export function HotkeysTab() {
  const platform = usePlatform();
  const { settings, updateSettings } = useSettings();
  const overrides = settings.keybindings.overrides;
  const resolved = resolveBindings(overrides);
  const conflicts = findConflicts(resolved);
  const [query, setQuery] = useState("");
  const filter = query.trim().toLowerCase();

  const setOverride = useCallback(
    (id: string, accelerator: string) => {
      updateSettings("keybindings.overrides", { ...overrides, [id]: accelerator });
    },
    [overrides, updateSettings],
  );

  const resetOverride = useCallback(
    (id: string) => {
      const next = { ...overrides };
      delete next[id];
      updateSettings("keybindings.overrides", next);
    },
    [overrides, updateSettings],
  );

  return (
    <>
      <div className="settings-section">
        <input
          type="search"
          className="settings-input settings-hotkey-search"
          placeholder="Search shortcuts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search shortcuts"
        />
      </div>
      {CATEGORY_ORDER.map((category) => {
        const commands = BINDABLE_COMMANDS.filter(
          (c) => c.category === category && c.label.toLowerCase().includes(filter),
        );
        if (commands.length === 0) return null;
        return (
          <div className="settings-section" key={category}>
            <div className="settings-section-title">{category}</div>
            {commands.map((command) => {
              const accelerator = overrides[command.id] || command.defaultAccelerator;
              return (
                <HotkeyRow
                  key={command.id}
                  command={command}
                  accelerator={accelerator}
                  platform={platform}
                  isOverridden={command.id in overrides}
                  isConflict={conflicts.has(command.id)}
                  onRecord={(value) => setOverride(command.id, value)}
                  onReset={() => resetOverride(command.id)}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}
