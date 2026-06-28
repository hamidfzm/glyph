import { createContext } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

// Context for app settings. Kept in a component-free module so the provider
// file stays Fast-Refresh-eligible (a file that exports a component plus a
// context bails out of React Fast Refresh). The provider lives in
// `SettingsProvider.tsx`; the consumer hook is `@/hooks/useSettings`.

export interface SettingsContextValue {
  settings: Settings;
  updateSettings: (path: string, value: unknown) => void;
  resetSettings: () => void;
  loaded: boolean;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  resetSettings: () => {},
  loaded: false,
});
