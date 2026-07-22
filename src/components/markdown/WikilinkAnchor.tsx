import { type ComponentPropsWithoutRef, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isMobilePlatform } from "@/lib/platform";
import { WikilinkPreview } from "./WikilinkPreview";

const OPEN_DELAY_MS = 350;
// Grace period so the pointer can travel from the anchor into the popover.
const CLOSE_DELAY_MS = 150;
// Hover has no touch equivalent, so the preview is desktop-only (#211).
const previewEnabled = !isMobilePlatform();

interface WikilinkAnchorProps extends ComponentPropsWithoutRef<"a"> {
  /** Named `wikilinkTarget`, not `target`, so it can't shadow the anchor attribute. */
  wikilinkTarget: string;
  /** Absolute path of the resolved note; absent when the link is broken. */
  path?: string;
  heading?: string;
  broken: boolean;
  onOpenWikilink?: (path: string, heading?: string) => void;
}

// A rendered `[[wikilink]]`: navigates in-app on click (never through openUrl,
// since the href is a placeholder) and peeks the target in a floating preview
// after a hover delay.
export function WikilinkAnchor({
  wikilinkTarget,
  path,
  heading,
  broken,
  onOpenWikilink,
  children,
  ...rest
}: WikilinkAnchorProps) {
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [previewOpen, setPreviewOpen] = useState(false);

  const cancelTimer = useCallback(() => clearTimeout(timerRef.current), []);
  useEffect(() => cancelTimer, [cancelTimer]);

  const scheduleOpen = useCallback(() => {
    cancelTimer();
    timerRef.current = setTimeout(() => setPreviewOpen(true), OPEN_DELAY_MS);
  }, [cancelTimer]);

  const scheduleClose = useCallback(() => {
    cancelTimer();
    timerRef.current = setTimeout(() => setPreviewOpen(false), CLOSE_DELAY_MS);
  }, [cancelTimer]);

  const closeNow = useCallback(() => {
    cancelTimer();
    setPreviewOpen(false);
  }, [cancelTimer]);

  const handleOpen = useCallback(() => {
    closeNow();
    if (!broken && path) onOpenWikilink?.(path, heading);
  }, [closeNow, broken, path, heading, onOpenWikilink]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    handleOpen();
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useValidAnchor: navigation routes through onClick by design: wikilinks resolve to in-app file paths, not URLs */}
      <a
        ref={anchorRef}
        href="#"
        onClick={handleClick}
        aria-disabled={broken ? true : undefined}
        onMouseEnter={previewEnabled ? scheduleOpen : undefined}
        onMouseLeave={previewEnabled ? scheduleClose : undefined}
        {...rest}
      >
        {children}
      </a>
      {previewOpen &&
        anchorRef.current &&
        createPortal(
          <WikilinkPreview
            anchor={anchorRef.current}
            target={wikilinkTarget}
            path={path}
            heading={heading}
            onOpen={handleOpen}
            onKeepOpen={cancelTimer}
            onClose={closeNow}
          />,
          document.body,
        )}
    </>
  );
}
