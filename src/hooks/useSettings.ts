import { useContext } from "react";
import { SettingsContext } from "../contexts/SettingsContext";

export function useSettings() {
  return useContext(SettingsContext);
}
