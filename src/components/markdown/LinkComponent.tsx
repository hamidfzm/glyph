import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type ComponentPropsWithoutRef, useCallback, useContext } from "react";
import { SettingsContext } from "../../contexts/SettingsContext";
import { scrollToHeading } from "../../lib/scrollToHeading";
import { ExternalLinkIcon } from "../icons/ExternalLinkIcon";

export function LinkComponent(props: ComponentPropsWithoutRef<"a">) {
  const { href, children, ...rest } = props;
  const { settings } = useContext(SettingsContext);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href) return;

      if (href.startsWith("#")) {
        e.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        if (id) scrollToHeading(id);
        return;
      }

      e.preventDefault();

      if (settings.behavior.confirmExternalLinks) {
        const confirmed = await ask(`Open this link in your browser?\n\n${href}`, {
          title: "Open External Link",
          kind: "info",
          okLabel: "Open",
          cancelLabel: "Cancel",
        });
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
