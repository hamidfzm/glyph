import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type ComponentPropsWithoutRef, useCallback, useContext } from "react";
import { ExternalLinkIcon } from "@/components/icons/ExternalLinkIcon";
import { SettingsContext } from "@/contexts/SettingsContext";
import { isOpenableRelativeHref } from "@/lib/relativePath";
import { scrollToHeading } from "@/lib/scrollToHeading";

export interface LinkComponentProps extends ComponentPropsWithoutRef<"a"> {
  onOpenWikilink?: (path: string, heading?: string) => void;
  /**
   * Open a relative markdown/canvas link in the workspace. Only provided when a
   * folder workspace is open; absent in single-file mode, where relative links
   * fall through to the browser as before.
   */
  onOpenRelativeFile?: (href: string) => void;
}

export function LinkComponent(props: LinkComponentProps) {
  // ReactMarkdown 10 passes the source `node` as a prop; strip so we don't
  // serialize it as an attribute on the rendered anchor.
  const {
    href,
    children,
    onOpenWikilink,
    onOpenRelativeFile,
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

      // A relative link to a workspace document opens in-app instead of the
      // browser. Resolution and root-clamping happen in the provided callback.
      if (onOpenRelativeFile && isOpenableRelativeHref(href)) {
        e.preventDefault();
        onOpenRelativeFile(href);
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
      onOpenRelativeFile,
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

  // In-app relative links are not external, so they don't get the launch icon.
  const isInternalRelative = !!onOpenRelativeFile && isOpenableRelativeHref(href);
  const isExternal = href && !href.startsWith("#") && !isInternalRelative;

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
      {isExternal && <ExternalLinkIcon />}
    </a>
  );
}
