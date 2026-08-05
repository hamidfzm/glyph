import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  configString,
  parseSiteConfig,
  readSiteConfigFile,
  SITE_CONFIG_PATH,
  serializeSiteConfig,
} from "@/lib/export/site/siteConfig";
import { DEFAULT_SITE_THEME_ID } from "@/lib/export/site/themes";
import { basename } from "@/lib/paths";

export interface SiteConfigForm {
  title: string;
  description: string;
  baseUrl: string;
  favicon: string;
  socialImage: string;
  /** "" means "don't write robots.txt". */
  robots: "" | "all" | "none";
  theme: string;
}

const EMPTY_FORM: SiteConfigForm = {
  title: "",
  description: "",
  baseUrl: "",
  favicon: "",
  socialImage: "",
  robots: "",
  theme: DEFAULT_SITE_THEME_ID,
};

/**
 * Form state over the workspace's `.glyph/site.json`. Loads the file on mount
 * and validates on save with the exporter's own parser, so anything that would
 * fail the export fails here, visibly, first.
 */
export function useSiteConfigForm(workspaceRoot: string | undefined) {
  const [form, setForm] = useState<SiteConfigForm>(EMPTY_FORM);
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

  const update = <K extends keyof SiteConfigForm>(key: K, value: SiteConfigForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** Validate and write the config. Resolves false when it could not be saved;
   *  the message is in `error`. */
  const save = async (): Promise<boolean> => {
    if (!workspaceRoot) return false;
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
      setError((err as Error).message);
      return false;
    }
    try {
      await invoke("create_dir_all", { path: `${workspaceRoot}/.glyph` });
      await invoke("write_file", {
        path: `${workspaceRoot}/${SITE_CONFIG_PATH}`,
        content: serialized,
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  return { form, update, error, save };
}
