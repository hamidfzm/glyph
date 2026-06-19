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
// injected highlight stylesheet) and locale (<html lang>/<html dir>). The
// providers read settings from SettingsContext themselves; App only needs it
// for the theme/locale hooks. All other wiring lives in AppShell.
export function App() {
  const { settings } = useSettings();
  useTheme(settings.appearance.theme);
  useCodeThemeStyle(settings.appearance.codeTheme);
  useLocale(settings.appearance.locale);

  return (
    <TabsProvider>
      <SidebarLayoutProvider>
        <SyncConfigProvider>
          <AppShell />
        </SyncConfigProvider>
      </SidebarLayoutProvider>
    </TabsProvider>
  );
}
