import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useContext } from "react";
import { useTranslation } from "react-i18next";
import { SettingsContext } from "@/contexts/SettingsContext";

/**
 * Open a URL a document wrote in the system handler, behind the external-link
 * prompt when the setting asks for one. One path for every document-authored
 * link, so a canvas card gets the same prompt as a markdown link.
 */
export function useOpenExternalLink() {
  const { settings } = useContext(SettingsContext);
  const { t } = useTranslation("common");
  const confirm = settings.behavior.confirmExternalLinks;

  return useCallback(
    async (href: string) => {
      if (confirm) {
        const confirmed = await ask(t("link.confirmMessage", { url: href }), {
          title: t("link.openExternalTitle"),
          kind: "info",
          okLabel: t("link.open"),
          cancelLabel: t("link.cancel"),
        });
        if (!confirmed) return;
      }
      // The opener plugin rejects targets its scope refuses. There is nothing
      // to recover, and a dropped rejection would surface as a crash.
      try {
        await openUrl(href);
      } catch {
        // Nothing opened; the click is a no-op.
      }
    },
    [confirm, t],
  );
}
