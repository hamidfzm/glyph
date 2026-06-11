import { PluginsProvider } from "@/contexts/PluginsContext";
import { SidebarLayoutProvider } from "@/contexts/SidebarLayoutContext";
import { TabsProvider } from "@/contexts/TabsContext";
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
    <PluginsProvider>
      <TabsProvider settings={settings} updateSettings={updateSettings}>
        <SidebarLayoutProvider settings={settings} updateSettings={updateSettings}>
          <AppShell />
        </SidebarLayoutProvider>
      </TabsProvider>
    </PluginsProvider>
  );
}
