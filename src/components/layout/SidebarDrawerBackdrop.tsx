import { useTranslation } from "react-i18next";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";

// Dimmed backdrop behind the compact (phone) sidebar drawers. Tapping it
// dismisses the open drawer, the "tap outside to close" that makes the panel
// read as a drawer. Only rendered on compact when a drawer is actually open,
// so it never covers the desktop beside-layout. Sits below the panel (z-20)
// and above the document.
export function SidebarDrawerBackdrop() {
  const { t } = useTranslation("common");
  const { compact, filesVisible, outlineVisible, closeCompactPanels } = useSidebarLayoutContext();
  if (!compact || (!filesVisible && !outlineVisible)) return null;
  return (
    <button
      type="button"
      aria-label={t("sidebar.closeDrawer")}
      className="sidebar-drawer-backdrop absolute inset-0 z-10 bg-black/40"
      onClick={closeCompactPanels}
    />
  );
}
