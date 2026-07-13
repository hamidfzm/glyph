import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type RegistryEntry, registryReadmeUrl } from "@/lib/plugins/marketplace";
import { PluginPermissionsLine } from "./PluginPermissionsLine";

const btnClass =
  "px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]";

/**
 * Marketplace details view for one plugin: header with badges and actions,
 * plus the plugin's registry README rendered below. Links open externally.
 */
export function PluginDetail({
  entry,
  onBack,
  onInstall,
}: {
  entry: RegistryEntry;
  onBack: () => void;
  onInstall: (entry: RegistryEntry) => void;
}) {
  const { t } = useTranslation("plugins");
  const [readme, setReadme] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReadme(null);
    setFailed(false);
    fetch(registryReadmeUrl(entry.id))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (!cancelled) setReadme(text);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button type="button" className={btnClass} onClick={onBack}>
          {t("back")}
        </button>
        <div className="flex-1 min-w-0 text-sm text-[var(--color-text-primary)] truncate">
          {entry.name} <span className="text-[var(--color-text-secondary)]">v{entry.version}</span>
          {entry.official && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] uppercase rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]">
              {t("officialBadge")}
            </span>
          )}
        </div>
        <button type="button" className={btnClass} onClick={() => onInstall(entry)}>
          {t("install")}
        </button>
      </div>
      <PluginPermissionsLine permissions={entry.permissions} sandbox={entry.sandbox} />
      <div className="mt-3 text-sm markdown-body">
        {failed ? (
          <p className="text-[var(--color-text-secondary)]">{t("detailsError")}</p>
        ) : readme === null ? (
          <p className="text-[var(--color-text-secondary)]">{t("detailsLoading")}</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    // ReactMarkdown only renders anchors for real links, so
                    // href is present; a bad value just rejects and is ignored.
                    void openUrl(String(href)).catch(() => undefined);
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {readme}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
