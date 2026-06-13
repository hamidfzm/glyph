import { SidebarLayoutProvider } from "@/contexts/SidebarLayoutContext";
import { SyncConfigProvider } from "@/contexts/SyncConfigContext";
import { TabsProvider } from "@/contexts/TabsContext";
import { useCodeThemeStyle } from "@/hooks/useCodeThemeStyle";
import { useLocale } from "@/hooks/useLocale";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import { AppShell } from "./AppShell";

// Root shell: mounts the providers that the rest of the tree reads from, and
// applies global side-effects with no business logic — theme (CSS class +
// injected highlight stylesheet) and locale (<html lang>/<html dir>). All
// wiring — menu events, AI/TTS/Print, autosave, etc — lives in AppShell.
export function App() {
  const { settings, updateSettings } = useSettings();
  useTheme(settings.appearance.theme);
  useCodeThemeStyle(settings.appearance.codeTheme);
  useLocale(settings.appearance.locale);

  return (
    <TabsProvider settings={settings} updateSettings={updateSettings}>
      <SidebarLayoutProvider settings={settings} updateSettings={updateSettings}>
        <SyncConfigProvider>
          <AppShell />
        </SyncConfigProvider>
      </SidebarLayoutProvider>
    </TabsProvider>
  );
}
