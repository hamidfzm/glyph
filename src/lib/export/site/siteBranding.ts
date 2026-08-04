import { invoke } from "@tauri-apps/api/core";
import { resolveConfigAsset, SITE_CONFIG_PATH, type SiteConfig } from "./siteConfig";

export interface SiteBranding {
  /** Absolute source path, for copying the file into the output. */
  faviconAbs: string | null;
  /** Site-relative path, for the emitted <link>/<meta>. */
  faviconRel: string | null;
  socialImageAbs: string | null;
  socialImageRel: string | null;
}

/**
 * Locate the site's favicon and social image. A configured asset that doesn't
 * exist is a config error, not a broken tag discovered after publishing;
 * `resolveConfigAsset` also clamps the path to the workspace, since the config
 * may come from an untrusted repo. Without a config, a conventional root
 * favicon is picked up automatically.
 */
export async function resolveSiteBranding(root: string, config: SiteConfig): Promise<SiteBranding> {
  const fileExists = (path: string) =>
    invoke("get_file_metadata", { path }).then(
      () => true,
      () => false,
    );
  // A configured favicon/social image that doesn't exist is a config error,
  // not a broken <link> discovered after publishing; resolveConfigAsset also
  // clamps the path to the workspace, since the config may come from an
  // untrusted repo. Without a config, a conventional root favicon is picked
  // up automatically.
  let faviconAbs: string | null = null;
  let faviconRel: string | null = null;
  if (config.favicon !== null) {
    const resolved = resolveConfigAsset(root, config.favicon, "favicon");
    if (!(await fileExists(resolved.abs))) {
      throw new Error(`${SITE_CONFIG_PATH}: favicon not found in the workspace: ${config.favicon}`);
    }
    faviconAbs = resolved.abs;
    faviconRel = resolved.siteRel;
  } else {
    for (const candidate of ["favicon.ico", "favicon.png", "favicon.svg"]) {
      if (await fileExists(`${root}/${candidate}`)) {
        faviconAbs = `${root}/${candidate}`;
        faviconRel = candidate;
        break;
      }
    }
  }
  let socialImageAbs: string | null = null;
  let socialImageRel: string | null = null;
  if (config.socialImage !== null) {
    const resolved = resolveConfigAsset(root, config.socialImage, "socialImage");
    if (!(await fileExists(resolved.abs))) {
      throw new Error(
        `${SITE_CONFIG_PATH}: socialImage not found in the workspace: ${config.socialImage}`,
      );
    }
    socialImageAbs = resolved.abs;
    socialImageRel = resolved.siteRel;
  }

  return { faviconAbs, faviconRel, socialImageAbs, socialImageRel };
}
