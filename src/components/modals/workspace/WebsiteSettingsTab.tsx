import { useTranslation } from "react-i18next";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { type SiteConfigForm, useSiteConfigForm } from "@/hooks/useSiteConfigForm";
import { BUILTIN_SITE_THEMES } from "@/lib/export/site/themes";
import { basename } from "@/lib/paths";

interface WebsiteSettingsTabProps {
  onClose: () => void;
}

/**
 * The Website tab of Workspace Settings: a form over `.glyph/site.json`
 * (title, description, base URL, favicon, social image, robots.txt, theme).
 * Loads the current file on mount; Save validates with the exporter's own
 * parser so anything that would fail the export fails here, visibly, first.
 */
export function WebsiteSettingsTab({ onClose }: WebsiteSettingsTabProps) {
  const { t } = useTranslation("workspaceSettings");
  const workspaceRoot = useWorkspaceRoot();
  const plugins = usePluginsOptional();
  const pluginThemes = useRegistryEntries(plugins?.siteThemes ?? null);
  const { form, update, error, save } = useSiteConfigForm(workspaceRoot);

  if (!workspaceRoot) return null;

  const themes = [...BUILTIN_SITE_THEMES, ...pluginThemes];

  return (
    <>
      <p className="settings-section-description">{t("website.description")}</p>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("website.fields.title.label")}{" "}
          <span className="settings-field-hint">{t("website.fields.title.hint")}</span>
        </span>
        <input
          type="text"
          className="settings-input"
          placeholder={basename(workspaceRoot)}
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          spellCheck={false}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">{t("website.fields.description.label")}</span>
        <input
          type="text"
          className="settings-input"
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("website.fields.baseUrl.label")}{" "}
          <span className="settings-field-hint">{t("website.fields.baseUrl.hint")}</span>
        </span>
        <input
          type="url"
          className="settings-input"
          placeholder="https://example.com/notes/"
          value={form.baseUrl}
          onChange={(e) => update("baseUrl", e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("website.fields.favicon.label")}{" "}
          <span className="settings-field-hint">{t("website.fields.favicon.hint")}</span>
        </span>
        <input
          type="text"
          className="settings-input"
          placeholder="assets/logo.png"
          value={form.favicon}
          onChange={(e) => update("favicon", e.target.value)}
          spellCheck={false}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">
          {t("website.fields.socialImage.label")}{" "}
          <span className="settings-field-hint">{t("website.fields.socialImage.hint")}</span>
        </span>
        <input
          type="text"
          className="settings-input"
          placeholder="assets/card.png"
          value={form.socialImage}
          onChange={(e) => update("socialImage", e.target.value)}
          spellCheck={false}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field-label">{t("website.fields.robots.label")}</span>
        <select
          className="settings-select"
          value={form.robots}
          onChange={(e) => update("robots", e.target.value as SiteConfigForm["robots"])}
        >
          <option value="">{t("website.fields.robots.none")}</option>
          <option value="all">{t("website.fields.robots.all")}</option>
          <option value="none">{t("website.fields.robots.disallow")}</option>
        </select>
      </label>

      <label className="settings-field">
        <span className="settings-field-label">{t("website.fields.theme.label")}</span>
        <select
          className="settings-select"
          value={form.theme}
          onChange={(e) => update("theme", e.target.value)}
        >
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}

      <div className="settings-actions">
        <button type="button" className="settings-secondary-btn" onClick={onClose}>
          {t("website.cancel")}
        </button>
        <button
          type="button"
          className="settings-primary-btn"
          onClick={async () => {
            if (await save()) onClose();
          }}
        >
          {t("website.save")}
        </button>
      </div>
    </>
  );
}
