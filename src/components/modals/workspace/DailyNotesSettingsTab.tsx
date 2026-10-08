import { useTranslation } from "react-i18next";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { useDailyNotesForm } from "@/hooks/useDailyNotesForm";

interface DailyNotesSettingsTabProps {
  onClose: () => void;
}

/** The Daily Notes tab of Workspace Settings, a form over the `dailyNotes` block of `.glyph/config.json`. */
export function DailyNotesSettingsTab({ onClose }: DailyNotesSettingsTabProps) {
  const { t } = useTranslation("workspaceSettings");
  const workspaceRoot = useWorkspaceRoot();
  const { form, update, previewPath, error, save } = useDailyNotesForm(workspaceRoot);

  if (!workspaceRoot) return null;

  const todayPath = previewPath(new Date());

  return (
    <>
      <p className="settings-section-description">{t("dailyNotes.description")}</p>

      {form && (
        <>
          <label className="settings-field">
            <span className="settings-field-label">
              {t("dailyNotes.fields.folder.label")}{" "}
              <span className="settings-field-hint">{t("dailyNotes.fields.folder.hint")}</span>
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
              {t("dailyNotes.fields.filenamePattern.label")}{" "}
              <span className="settings-field-hint">
                {t("dailyNotes.fields.filenamePattern.hint")}
              </span>
            </span>
            <input
              type="text"
              className="settings-input"
              value={form.filenamePattern}
              onChange={(e) => update("filenamePattern", e.target.value)}
              spellCheck={false}
            />
            {todayPath && (
              <span className="settings-field-hint">
                {t("dailyNotes.preview", { path: todayPath })}
              </span>
            )}
          </label>

          <label className="settings-field">
            <span className="settings-field-label">
              {t("dailyNotes.fields.template.label")}{" "}
              <span className="settings-field-hint">{t("dailyNotes.fields.template.hint")}</span>
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
        </>
      )}

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}

      <div className="settings-actions">
        <button type="button" className="settings-secondary-btn" onClick={onClose}>
          {t("dailyNotes.cancel")}
        </button>
        <button
          type="button"
          className="settings-primary-btn"
          disabled={!form}
          onClick={async () => {
            if (await save()) onClose();
          }}
        >
          {t("dailyNotes.save")}
        </button>
      </div>
    </>
  );
}
