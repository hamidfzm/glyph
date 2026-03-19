import { useCallback, useContext, type ComponentPropsWithoutRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { SettingsContext } from "../../contexts/SettingsContext";
import { ExternalLinkIcon } from "../icons/ExternalLinkIcon";

export function LinkComponent(props: ComponentPropsWithoutRef<"a">) {
  const { href, children, ...rest } = props;
  const { settings } = useContext(SettingsContext);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href || href.startsWith("#")) return;
      e.preventDefault();

      if (settings.behavior.confirmExternalLinks) {
        const confirmed = await ask(
          `Open this link in your browser?\n\n${href}`,
          {
            title: "Open External Link",
            kind: "info",
            okLabel: "Open",
            cancelLabel: "Cancel",
          },
        );
        if (!confirmed) return;
      }

      await openUrl(href);
    },
    [href, settings.behavior.confirmExternalLinks],
  );

  const isExternal = href && !href.startsWith("#");

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
      {isExternal && <ExternalLinkIcon />}
    </a>
  );
}
