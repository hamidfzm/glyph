import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { dailyNotePath, dailyNotesProblem, normalizeDailyNotes } from "@/lib/dailyNotes";
import {
  type DailyNotesSettings,
  getDailyNotesSettings,
  setDailyNotesSettings,
} from "@/lib/workspace";

/** The settings as the fields hold them: a blank template is "" here. */
type DailyNotesForm = Required<DailyNotesSettings>;

/** `form` stays null until the stored settings load, so a Save can never write defaults over them. */
export function useDailyNotesForm(workspaceRoot: string | undefined) {
  const { t } = useTranslation("workspaceSettings");
  const [form, setForm] = useState<DailyNotesForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceRoot) return;
    let cancelled = false;
    setForm(null);
    setError(null);
    getDailyNotesSettings(workspaceRoot)
      .then((settings) => {
        if (!cancelled) setForm({ ...settings, template: settings.template ?? "" });
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  const update = <K extends keyof DailyNotesForm>(key: K, value: DailyNotesForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  /** Null while the values are loading or not valid. */
  const previewPath = (date: Date): string | null => {
    if (!form || dailyNotesProblem(form, date)) return null;
    return dailyNotePath(form, date);
  };

  /** Resolves false when the settings were not saved; the message is in `error`. */
  const save = async (): Promise<boolean> => {
    if (!workspaceRoot || !form) return false;
    const problem = dailyNotesProblem(form, new Date());
    if (problem) {
      setError(t(`dailyNotes.errors.${problem}`));
      return false;
    }
    try {
      await setDailyNotesSettings(workspaceRoot, normalizeDailyNotes(form));
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  return { form, update, previewPath, error, save };
}
