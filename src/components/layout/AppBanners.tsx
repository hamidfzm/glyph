import { useTabsContext } from "@/contexts/TabsContext";
import { useDefaultAppPrompt } from "@/hooks/useDefaultAppPrompt";
import { useErrorReportingPrompt } from "@/hooks/useErrorReportingPrompt";
import { useSettings } from "@/hooks/useSettings";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { DefaultAppBanner } from "./DefaultAppBanner";
import { ErrorReportingBanner } from "./ErrorReportingBanner";
import { UpdateBanner } from "./UpdateBanner";
import { WorkspaceNoticeBanner } from "./WorkspaceNoticeBanner";

/** The stack of one-line notices above the tab bar: available update, the
 *  first-run default-app and error-reporting nudges, and workspace notices. */
export function AppBanners() {
  const { settings, loaded } = useSettings();
  const { workspaceNotice, dismissWorkspaceNotice } = useTabsContext();
  // Once-per-session check for a newer GitHub release; the banner shows only
  // when the user has the feature on and an update is actually available.
  const updateCheck = useUpdateCheck(settings.behavior.checkForUpdates, loaded);
  // One-time first-run nudge to make Glyph the default Markdown app.
  const defaultAppPrompt = useDefaultAppPrompt();
  const errorReportingPrompt = useErrorReportingPrompt();

  return (
    <>
      <UpdateBanner update={updateCheck.update} onDismiss={updateCheck.dismiss} />
      {defaultAppPrompt.show && (
        <DefaultAppBanner
          onSetDefault={defaultAppPrompt.setDefault}
          onNotNow={defaultAppPrompt.notNow}
          onNever={defaultAppPrompt.never}
        />
      )}
      {errorReportingPrompt.show && (
        <ErrorReportingBanner
          onEnable={errorReportingPrompt.enable}
          onDecline={errorReportingPrompt.decline}
        />
      )}
      <WorkspaceNoticeBanner notice={workspaceNotice} onDismiss={dismissWorkspaceNotice} />
    </>
  );
}
