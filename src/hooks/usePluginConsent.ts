import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  consentBody,
  consentRequest,
  consentTitle,
  grantAfterConsent,
} from "@/lib/plugins/consent";
import { loadGrants, type PluginGrant, saveGrants } from "@/lib/plugins/grantsStore";

/** The identity and declared surface consent is asked for. */
export interface ConsentSubject {
  id: string;
  name: string;
  sandbox: boolean;
  permissions?: string[];
}

/**
 * Owns the persisted per-plugin grants and the native consent dialogs.
 * `ensureConsent` is idempotent: once a grant covers the subject's declared
 * surface it resolves true without prompting, so post-install re-checks and
 * unchanged updates are silent.
 */
export function usePluginConsent() {
  const { t } = useTranslation("plugins");
  // A ref, not state: only async install/enable flows read the grants, and
  // they always want the current value.
  const grantsRef = useRef<Record<string, PluginGrant>>({});

  const hydrateGrants = useCallback(async () => {
    grantsRef.current = await loadGrants();
  }, []);

  const hasFullTrust = useCallback((id: string) => grantsRef.current[id]?.fullTrust === true, []);

  const ensureConsent = useCallback(
    async (subject: ConsentSubject): Promise<boolean> => {
      const permissions = subject.permissions ?? [];
      const request = consentRequest(subject.sandbox, permissions, grantsRef.current[subject.id]);
      if (!request) return true;
      const accepted = await ask(consentBody(t, subject.name, request), {
        title: consentTitle(t, request),
        kind: "warning",
      });
      if (accepted) {
        grantsRef.current = {
          ...grantsRef.current,
          [subject.id]: grantAfterConsent(subject.sandbox, permissions),
        };
        void saveGrants(grantsRef.current);
      }
      return accepted;
    },
    [t],
  );

  const revokeGrant = useCallback((id: string) => {
    if (!(id in grantsRef.current)) return;
    const next = { ...grantsRef.current };
    delete next[id];
    grantsRef.current = next;
    void saveGrants(next);
  }, []);

  return { hydrateGrants, hasFullTrust, ensureConsent, revokeGrant };
}
