import { useEffect, useState } from "react";
import { dailyNotePath, dailyNotesProblem } from "./notePath";
import type { Translate } from "./openTodaysNote";
import { type DailyNotesSettings, storedSettings } from "./settings";

interface DailyNotesSettingsPanelProps {
  load: () => Promise<DailyNotesSettings>;
  save: (settings: DailyNotesSettings) => Promise<void>;
  t: Translate;
}

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

/**
 * The Daily Notes tab of Workspace Settings. The fields and Save stay back
 * until the stored settings load, so a Save can never write the defaults over them.
 */
export function DailyNotesSettingsPanel({ load, save, t }: DailyNotesSettingsPanelProps) {
  const [form, setForm] = useState<DailyNotesSettings | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((settings) => {
        if (!cancelled) setForm(settings);
      })
      .catch((err) => {
        if (!cancelled) setStatus({ kind: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const description = <p className="settings-section-description">{t("settings.description")}</p>;
  const error = status.kind === "error" && (
    <p className="settings-error" role="alert">
      {status.message}
    </p>
  );

  if (!form) {
    return (
      <>
        {description}
        {error}
      </>
    );
  }

  const update = (key: keyof DailyNotesSettings, value: string) => {
    setForm({ ...form, [key]: value });
    setStatus({ kind: "idle" });
  };

  const handleSave = async () => {
    const problem = dailyNotesProblem(form, new Date());
    if (problem) {
      setStatus({ kind: "error", message: t(`settings.errors.${problem}`) });
      return;
    }
    try {
      await save(storedSettings(form));
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  };

  const today = new Date();
  const previewPath = dailyNotesProblem(form, today) ? null : dailyNotePath(form, today);

  return (
    <>
      {description}

      <label className="settings-field">
        <span className="settings-field-label">
          {t("settings.folder.label")}{" "}
          <span className="settings-field-hint">{t("settings.folder.hint")}</span>
        </span>
        <input
          type="text"
          className="settings-input"
          value={form.folder}
          onChange={(e) => update("folder", e.target.value)}
          spellCheck={false}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("settings.filenamePattern.label")}{" "}
          <span className="settings-field-hint">{t("settings.filenamePattern.hint")}</span>
        </span>
        <input
          type="text"
          className="settings-input"
          value={form.filenamePattern}
          onChange={(e) => update("filenamePattern", e.target.value)}
          spellCheck={false}
        />
        {previewPath && (
          <span className="settings-field-hint">
            {t("settings.preview", { path: previewPath })}
          </span>
        )}
      </label>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("settings.template.label")}{" "}
          <span className="settings-field-hint">{t("settings.template.hint")}</span>
        </span>
        <input
          type="text"
          className="settings-input"
          placeholder="templates/daily.md"
          value={form.template}
          onChange={(e) => update("template", e.target.value)}
          spellCheck={false}
        />
      </label>

      {error}

      <div className="settings-actions">
        <button type="button" className="settings-primary-btn" onClick={handleSave}>
          {t("settings.save")}
        </button>
        {status.kind === "saved" && (
          <span className="settings-field-hint" role="status">
            {t("settings.saved")}
          </span>
        )}
      </div>
    </>
  );
}
