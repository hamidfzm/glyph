import { SidebarLayoutProvider } from "@/contexts/SidebarLayoutContext";
import { SyncConfigProvider } from "@/contexts/SyncConfigContext";
import { TabsProvider } from "@/contexts/TabsContext";
import { WorkspaceRootProvider } from "@/contexts/WorkspaceRootContext";
import { useCodeThemeStyle } from "@/hooks/useCodeThemeStyle";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import { AppShell } from "./AppShell";

// Root shell: mounts the providers that the rest of the tree reads from, and
// applies global theme side-effects (CSS class + injected highlight stylesheet).
// All wiring — menu events, AI/TTS/Print, autosave, etc — lives in AppShell.
export function App() {
  const { settings, updateSettings } = useSettings();
  useTheme(settings.appearance.theme);
  useCodeThemeStyle(settings.appearance.codeTheme);

  return (
    <TabsProvider settings={settings} updateSettings={updateSettings}>
      <WorkspaceRootProvider>
        <SidebarLayoutProvider settings={settings} updateSettings={updateSettings}>
          <SyncConfigProvider>
            <AppShell />
          </SyncConfigProvider>
        </SidebarLayoutProvider>
      </WorkspaceRootProvider>
    </TabsProvider>
  );
}
