import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import type { ColorSchemeProvider, MissingReason } from "@/lib/colorSchemeStatus";

const NOTE_KEY: Record<MissingReason, string> = {
  off: "off",
  disabled: "off",
  notInstalled: "notInstalled",
  unavailable: "unavailable",
};

interface ColorSchemeNoteProps {
  /** The saved scheme's name. */
  scheme: string;
  reason: MissingReason;
  provider: ColorSchemeProvider;
  onOpenPlugins: () => void;
}

/** Names the plugin a saved scheme comes from and offers the way back to it. */
export function ColorSchemeNote({ scheme, reason, provider, onOpenPlugins }: ColorSchemeNoteProps) {
  const { t } = useTranslation(["settings", "plugins"]);
  const { updateSettings } = useSettings();
  const { coreKey } = provider;
  const plugin = coreKey ? t(`plugins:core.${coreKey}.name`) : (provider.name ?? provider.id);

  return (
    <div className="settings-description">
      {t(`appearance.colorScheme.note.${NOTE_KEY[reason]}`, { scheme, plugin })}{" "}
      {coreKey && reason === "off" && (
        <button
          type="button"
          className="settings-link"
          onClick={() => updateSettings(`corePlugins.${coreKey}`, true)}
        >
          {t("appearance.colorScheme.turnOn")}
        </button>
      )}
      {(reason === "disabled" || reason === "unavailable") && (
        <button type="button" className="settings-link" onClick={onOpenPlugins}>
          {t("appearance.colorScheme.openPlugins")}
        </button>
      )}
    </div>
  );
}
