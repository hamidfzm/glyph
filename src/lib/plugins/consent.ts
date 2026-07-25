import type { PluginGrant } from "./grantsStore";

/**
 * Which consent dialog an install, update, or enable needs:
 * - `install`: first consent for a sandboxed plugin.
 * - `fullTrust`: the plugin opts out of the sandbox; distinct warning.
 * - `expanded`: an already-granted plugin now declares more permissions.
 */
export type ConsentKind = "install" | "fullTrust" | "expanded";

export interface ConsentRequest {
  kind: ConsentKind;
  /** Declared permissions not yet granted (all of them on first consent). */
  newPermissions: string[];
}

/**
 * Decide whether running this plugin needs fresh consent, and which dialog.
 * Returns null when the existing grant already covers the declared surface,
 * so unchanged updates and re-enables never re-prompt.
 */
export function consentRequest(
  sandbox: boolean,
  permissions: readonly string[],
  grant: PluginGrant | undefined,
): ConsentRequest | null {
  const granted = grant?.permissions ?? [];
  const newPermissions = permissions.filter((p) => !granted.includes(p));
  if (!sandbox && !grant?.fullTrust) {
    return { kind: "fullTrust", newPermissions };
  }
  if (!grant) {
    return { kind: "install", newPermissions };
  }
  if (newPermissions.length > 0) {
    return { kind: "expanded", newPermissions };
  }
  return null;
}

/** The grant to persist after the user accepts a {@link ConsentRequest}. */
export function grantAfterConsent(sandbox: boolean, permissions: readonly string[]): PluginGrant {
  return { permissions: [...permissions], fullTrust: !sandbox };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Dialog title for a {@link ConsentRequest}: full trust gets its own. */
export function consentTitle(t: Translate, request: ConsentRequest): string {
  return request.kind === "fullTrust" ? t("consentFullTrustTitle") : t("consentTitle");
}

/** Dialog body: what the plugin is, its trust mode, and the (new) permissions. */
export function consentBody(t: Translate, name: string, request: ConsentRequest): string {
  const lines: string[] = [];
  if (request.kind === "fullTrust") {
    lines.push(t("consentFullTrustBody", { name }));
  } else if (request.kind === "expanded") {
    lines.push(t("consentExpandedBody", { name }));
  } else {
    lines.push(t("consentBody", { name }), t("consentSandboxed"));
  }
  if (request.newPermissions.length > 0) {
    const heading =
      request.kind === "expanded" ? t("consentNewPermissions") : t("consentPermissions");
    lines.push(`${heading}\n${request.newPermissions.map((p) => `- ${p}`).join("\n")}`);
  }
  return lines.join("\n\n");
}
