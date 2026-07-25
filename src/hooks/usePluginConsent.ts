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
  // Grant reads and writes wait for hydration, so a consent accepted during a
  // slow startup cannot persist a map missing the other plugins' grants.
  const hydrationRef = useRef<Promise<void>>(Promise.resolve());

  const hydrateGrants = useCallback(() => {
    hydrationRef.current = loadGrants().then((grants) => {
      grantsRef.current = grants;
    });
    return hydrationRef.current;
  }, []);

  const hasFullTrust = useCallback((id: string) => grantsRef.current[id]?.fullTrust === true, []);

  const writeGrant = useCallback((id: string, grant: PluginGrant | undefined) => {
    const next = { ...grantsRef.current };
    if (grant === undefined) {
      delete next[id];
    } else {
      next[id] = grant;
    }
    grantsRef.current = next;
    void saveGrants(next);
  }, []);

  /** Snapshot one plugin's grant, for undoing a failed flow via restoreGrant. */
  const getGrant = useCallback(async (id: string): Promise<PluginGrant | undefined> => {
    await hydrationRef.current;
    return grantsRef.current[id];
  }, []);

  const ensureConsent = useCallback(
    async (subject: ConsentSubject): Promise<boolean> => {
      await hydrationRef.current;
      const permissions = subject.permissions ?? [];
      const grant = grantsRef.current[subject.id];
      const request = consentRequest(subject.sandbox, permissions, grant);
      if (!request) {
        // A sandboxed version retires an older full-trust grant, so a later
        // flip back to sandbox:false re-runs the full-access warning.
        if (subject.sandbox && grant?.fullTrust) {
          writeGrant(subject.id, grantAfterConsent(true, permissions));
        }
        return true;
      }
      const accepted = await ask(consentBody(t, subject.name, request), {
        title: consentTitle(t, request),
        kind: "warning",
      });
      if (accepted) {
        writeGrant(subject.id, grantAfterConsent(subject.sandbox, permissions));
      }
      return accepted;
    },
    [t, writeGrant],
  );

  const revokeGrant = useCallback(
    async (id: string) => {
      await hydrationRef.current;
      if (!(id in grantsRef.current)) return;
      writeGrant(id, undefined);
    },
    [writeGrant],
  );

  return {
    hydrateGrants,
    hasFullTrust,
    getGrant,
    restoreGrant: writeGrant,
    ensureConsent,
    revokeGrant,
  };
}
