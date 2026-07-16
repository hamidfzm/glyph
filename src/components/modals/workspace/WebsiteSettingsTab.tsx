import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useWorkspaceRoot } from "@/contexts/TabsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import {
  configString,
  parseSiteConfig,
  readSiteConfigFile,
  SITE_CONFIG_PATH,
  serializeSiteConfig,
} from "@/lib/export/site/siteConfig";
import { BUILTIN_SITE_THEMES, DEFAULT_SITE_THEME_ID } from "@/lib/export/site/themes";
import { basename } from "@/lib/paths";

interface WebsiteSettingsTabProps {
  onClose: () => void;
}

interface FormState {
  title: string;
  description: string;
  baseUrl: string;
  favicon: string;
  socialImage: string;
  /** "" means "don't write robots.txt". */
  robots: "" | "all" | "none";
  theme: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  baseUrl: "",
  favicon: "",
  socialImage: "",
  robots: "",
  theme: DEFAULT_SITE_THEME_ID,
};

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
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  // The raw file contents as loaded, so Save preserves keys this tab does
  // not know about (a config written by a newer Glyph must survive a visit).
  const [rawConfig, setRawConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!workspaceRoot) return;
    let cancelled = false;
    (async () => {
      const raw = await readSiteConfigFile(workspaceRoot, (path) =>
        invoke<string>("read_file", { path }),
      );
      if (cancelled) return;
      setRawConfig(raw);
      setForm({
        title: configString(raw.title),
        description: configString(raw.description),
        baseUrl: configString(raw.baseUrl),
        favicon: configString(raw.favicon),
        socialImage: configString(raw.socialImage),
        robots: raw.robots === "all" || raw.robots === "none" ? raw.robots : "",
        theme: configString(raw.theme) || DEFAULT_SITE_THEME_ID,
      });
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  if (!workspaceRoot) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const values: Record<string, unknown> = {
      ...rawConfig,
      title: form.title,
      description: form.description,
      baseUrl: form.baseUrl,
      favicon: form.favicon,
      socialImage: form.socialImage,
      robots: form.robots === "" ? undefined : form.robots,
      // The default theme stays implicit so the file only pins a choice.
      theme: form.theme === DEFAULT_SITE_THEME_ID ? undefined : form.theme,
    };
    const serialized = serializeSiteConfig(values);
    try {
      // The exporter's parser is the source of truth for what is valid.
      parseSiteConfig(serialized, basename(workspaceRoot));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    try {
      await invoke("create_dir_all", { path: `${workspaceRoot}/.glyph` });
      await invoke("write_file", {
        path: `${workspaceRoot}/${SITE_CONFIG_PATH}`,
        content: serialized,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
          onChange={(e) => update("robots", e.target.value as FormState["robots"])}
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
        <button type="button" className="settings-primary-btn" onClick={handleSave}>
          {t("website.save")}
        </button>
      </div>
    </>
  );
}
