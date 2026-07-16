import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
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

interface SiteSettingsModalProps {
  open: boolean;
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
 * Per-workspace website-export settings: a form over `.glyph/site.json`
 * (title, description, base URL, favicon, social image, robots.txt, theme).
 * Loads the current file on open; Save validates with the exporter's own
 * parser so anything that would fail the export fails here, visibly, first.
 */
export function SiteSettingsModal({ open, onClose }: SiteSettingsModalProps) {
  const { t } = useTranslation("site");
  const workspaceRoot = useWorkspaceRoot();
  const plugins = usePluginsOptional();
  const pluginThemes = useRegistryEntries(plugins?.siteThemes ?? null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  // The raw file contents as loaded, so Save preserves keys this modal does
  // not know about (a config written by a newer Glyph must survive a visit).
  const [rawConfig, setRawConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!open || !workspaceRoot) return;
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
  }, [open, workspaceRoot]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!workspaceRoot) return;
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
    <div
      className="settings-overlay"
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("modal.heading")}
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>{t("modal.heading")}</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={t("modal.close")}
          >
            <ModalCloseIcon />
          </button>
        </div>

        <div className="settings-body settings-site">
          {!workspaceRoot ? (
            <p className="settings-empty">{t("empty")}</p>
          ) : (
            <>
              <p className="settings-section-description">{t("description")}</p>

              <label className="settings-field">
                <span className="settings-field-label">
                  {t("fields.title.label")}{" "}
                  <span className="settings-field-hint">{t("fields.title.hint")}</span>
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
                <span className="settings-field-label">{t("fields.description.label")}</span>
                <input
                  type="text"
                  className="settings-input"
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              </label>

              <label className="settings-field">
                <span className="settings-field-label">
                  {t("fields.baseUrl.label")}{" "}
                  <span className="settings-field-hint">{t("fields.baseUrl.hint")}</span>
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
                  {t("fields.favicon.label")}{" "}
                  <span className="settings-field-hint">{t("fields.favicon.hint")}</span>
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
                  {t("fields.socialImage.label")}{" "}
                  <span className="settings-field-hint">{t("fields.socialImage.hint")}</span>
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
                <span className="settings-field-label">{t("fields.robots.label")}</span>
                <select
                  className="settings-input"
                  value={form.robots}
                  onChange={(e) => update("robots", e.target.value as FormState["robots"])}
                >
                  <option value="">{t("fields.robots.none")}</option>
                  <option value="all">{t("fields.robots.all")}</option>
                  <option value="none">{t("fields.robots.disallow")}</option>
                </select>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">{t("fields.theme.label")}</span>
                <select
                  className="settings-input"
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
                  {t("cancel")}
                </button>
                <button type="button" className="settings-primary-btn" onClick={handleSave}>
                  {t("save")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
