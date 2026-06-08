import { useCallback } from "react";
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
      {CATEGORY_ORDER.map((category) => {
        const commands = BINDABLE_COMMANDS.filter((c) => c.category === category);
        if (commands.length === 0) return null;
        return (
          <div className="settings-section" key={category}>
            <div className="settings-section-title">{category}</div>
            {commands.map((command) => (
              <HotkeyRow
                key={command.id}
                command={command}
                accelerator={resolved.get(command.id) ?? command.defaultAccelerator}
                platform={platform}
                isOverridden={command.id in overrides}
                isConflict={conflicts.has(command.id)}
                onRecord={(accelerator) => setOverride(command.id, accelerator)}
                onReset={() => resetOverride(command.id)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
