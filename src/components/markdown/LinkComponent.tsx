import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type ComponentPropsWithoutRef, useCallback, useContext } from "react";
import { SettingsContext } from "@/contexts/SettingsContext";
import { scrollToHeading } from "@/lib/scrollToHeading";
import { ExternalLinkIcon } from "../icons/ExternalLinkIcon";

export interface LinkComponentProps extends ComponentPropsWithoutRef<"a"> {
  onOpenWikilink?: (path: string, heading?: string) => void;
}

export function LinkComponent(props: LinkComponentProps) {
  // ReactMarkdown 10 passes the source `node` as a prop; strip so we don't
  // serialize it as an attribute on the rendered anchor.
  const {
    href,
    children,
    onOpenWikilink,
    node: _node,
    ...rest
  } = props as LinkComponentProps & {
    node?: unknown;
  };
  const { settings } = useContext(SettingsContext);

  // Wikilink: identified by remarkWikilink-emitted data attributes. We never
  // route these through openUrl — they're either a workspace file (resolved)
  // or a no-op (broken).
  const wikilinkTarget = (rest as Record<string, unknown>)["data-wikilink"];
  const isWikilink = typeof wikilinkTarget === "string";
  const wikilinkPath = (rest as Record<string, unknown>)["data-wikilink-path"] as
    | string
    | undefined;
  const wikilinkHeading = (rest as Record<string, unknown>)["data-wikilink-heading"] as
    | string
    | undefined;
  const wikilinkBroken = "data-wikilink-broken" in (rest as object);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (isWikilink) {
        e.preventDefault();
        if (wikilinkBroken || !wikilinkPath) return;
        onOpenWikilink?.(wikilinkPath, wikilinkHeading);
        return;
      }

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
    [
      href,
      isWikilink,
      wikilinkBroken,
      wikilinkPath,
      wikilinkHeading,
      onOpenWikilink,
      settings.behavior.confirmExternalLinks,
    ],
  );

  if (isWikilink) {
    return (
      // biome-ignore lint/a11y/useValidAnchor: navigation routes through onClick by design — wikilinks resolve to in-app file paths, not URLs
      <a href="#" onClick={handleClick} aria-disabled={wikilinkBroken ? true : undefined} {...rest}>
        {children}
      </a>
    );
  }

  const isExternal = href && !href.startsWith("#");

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
      {isExternal && <ExternalLinkIcon />}
    </a>
  );
}
