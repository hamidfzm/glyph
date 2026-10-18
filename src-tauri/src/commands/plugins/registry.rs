// Marketplace installs. The registry index is the reviewed source of truth
// for what a package hashes to, so the backend fetches the index itself,
// downloads the package the matching entry names, and verifies the bytes
// before anything is written. The renderer names a plugin id and nothing
// else: a compromised one can install a reviewed package, never bytes of its
// own, and the full-trust code path stays behind the review.

use std::path::Path;

use sha2::{Digest, Sha256};

use super::manifest::{validate_id, MAX_TOTAL_BYTES};
use super::store::{install_package, read_package_manifest};
use super::InstalledPlugin;

pub(crate) const REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/glyph-md/plugins/main/index.json";

/// The index is a few hundred bytes per plugin.
pub(crate) const MAX_INDEX_BYTES: usize = 4 * 1024 * 1024;
/// A package holds at most what the manifest caps let it install.
pub(crate) const MAX_PACKAGE_BYTES: usize = MAX_TOTAL_BYTES as usize;

/// Where a package may be downloaded from: the registry's own org on GitHub
/// and the hosts GitHub serves release assets from, including the redirects
/// it answers an asset URL with. The same list the http capability held when
/// the renderer did the download. Judged on the parsed URL, as the client
/// will send it: a `..` segment or userinfo in the spelling is resolved
/// first, not matched as text.
pub(crate) fn is_marketplace_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        return false;
    }
    match parsed.host_str() {
        Some("raw.githubusercontent.com" | "github.com") => parsed.path().starts_with("/glyph-md/"),
        Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => true,
        _ => false,
    }
}

/// The fields of a registry entry an install needs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistryEntry {
    pub(crate) id: String,
    pub(crate) package_url: String,
    pub(crate) sha256: String,
}

#[derive(serde::Deserialize)]
struct RegistryIndex {
    #[serde(default)]
    plugins: Vec<serde_json::Value>,
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The registry entry for `id`, its package on a host `allows`. One malformed
/// entry does not fail the others: entries are matched by id first and read
/// in full only then.
pub(crate) fn find_entry(
    index_json: &str,
    id: &str,
    allows: fn(&str) -> bool,
) -> Result<RegistryEntry, String> {
    let index: RegistryIndex = serde_json::from_str(index_json)
        .map_err(|e| format!("the plugin registry is not valid JSON: {e}"))?;
    let entry = index
        .plugins
        .into_iter()
        .find(|entry| entry.get("id").and_then(|v| v.as_str()) == Some(id))
        .ok_or_else(|| format!("plugin \"{id}\" is not in the registry"))?;
    let entry: RegistryEntry = serde_json::from_value(entry)
        .map_err(|e| format!("the registry entry for \"{id}\" is malformed: {e}"))?;
    if !is_sha256_hex(&entry.sha256) {
        return Err(format!(
            "the registry entry for \"{id}\" has no valid sha256; refusing to install"
        ));
    }
    if !allows(&entry.package_url) {
        return Err(format!(
            "the registry entry for \"{id}\" names a package outside the marketplace hosts"
        ));
    }
    Ok(entry)
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Install downloaded `bytes` as `entry`: the hash must match the entry and
/// the manifest inside must identify as the entry's plugin, both checked
/// before anything touches disk, so a package that lies about itself cannot
/// replace another installed plugin on the way to being refused.
pub(crate) fn install_verified(
    root: &Path,
    entry: &RegistryEntry,
    bytes: &[u8],
) -> Result<InstalledPlugin, String> {
    validate_id(&entry.id)?;
    let actual = sha256_hex(bytes);
    if !actual.eq_ignore_ascii_case(&entry.sha256) {
        return Err(format!(
            "checksum mismatch for {}: expected {}, got {actual}",
            entry.id, entry.sha256
        ));
    }
    let manifest = read_package_manifest(bytes)?;
    if manifest.id != entry.id {
        return Err(format!(
            "package for {} declares manifest id {}; refusing to install",
            entry.id, manifest.id
        ));
    }
    install_package(root, bytes)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;

    fn index_with(entries: &str) -> String {
        format!(r#"{{"plugins":[{entries}]}}"#)
    }

    fn entry_json(id: &str, sha256: &str) -> String {
        format!(
            r#"{{"id":"{id}","name":"Pkg","version":"1.0.0","apiVersion":"0.16.0","packageUrl":"https://github.com/glyph-md/{id}/releases/download/v1/pkg.zip","sha256":"{sha256}"}}"#
        )
    }

    fn package() -> Vec<u8> {
        zip_of(&[
            ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
            ("main.js", b"export default {};"),
            ("assets/data.txt", b"x"),
        ])
    }

    fn entry_for(bytes: &[u8]) -> RegistryEntry {
        RegistryEntry {
            id: "com.x.pkg".into(),
            package_url: "https://github.com/glyph-md/pkg/releases/download/v1/pkg.zip".into(),
            sha256: sha256_hex(bytes),
        }
    }

    #[test]
    fn find_entry_reads_the_matching_entry_and_skips_malformed_others() {
        let good = entry_json("com.x.pkg", &"a".repeat(64));
        let index = index_with(&format!(r#"{{"id":"com.x.broken"}},{{"id":5}},{good}"#));
        let entry = find_entry(&index, "com.x.pkg", is_marketplace_url).unwrap();
        assert_eq!(
            entry.package_url,
            "https://github.com/glyph-md/com.x.pkg/releases/download/v1/pkg.zip"
        );
        assert_eq!(entry.sha256, "a".repeat(64));
        assert!(find_entry(&index, "com.x.broken", is_marketplace_url)
            .unwrap_err()
            .contains("malformed"));
        assert!(find_entry(&index, "com.x.absent", is_marketplace_url)
            .unwrap_err()
            .contains("not in the registry"));
        assert!(find_entry("nope", "com.x.pkg", is_marketplace_url)
            .unwrap_err()
            .contains("not valid JSON"));
        assert!(find_entry("{}", "com.x.pkg", is_marketplace_url)
            .unwrap_err()
            .contains("not in the registry"));
    }

    #[test]
    fn find_entry_refuses_an_entry_it_cannot_verify_or_fetch_from_the_marketplace() {
        for sha in ["", "abc", &"g".repeat(64), &"a".repeat(63)] {
            let index = index_with(&entry_json("com.x.pkg", sha));
            assert!(
                find_entry(&index, "com.x.pkg", is_marketplace_url)
                    .unwrap_err()
                    .contains("sha256"),
                "{sha:?}"
            );
        }
        for url in [
            "http://github.com/glyph-md/x/pkg.zip",
            "https://github.com/other-org/x/pkg.zip",
            "https://github.com.attacker.example/glyph-md/x.zip",
            "https://attacker.example/glyph-md/x.zip",
            "file:///tmp/x.zip",
        ] {
            let index = index_with(&entry_json("com.x.pkg", &"a".repeat(64)).replace(
                "https://github.com/glyph-md/com.x.pkg/releases/download/v1/pkg.zip",
                url,
            ));
            assert!(
                find_entry(&index, "com.x.pkg", is_marketplace_url)
                    .unwrap_err()
                    .contains("marketplace hosts"),
                "{url}"
            );
        }
    }

    #[test]
    fn install_verified_installs_a_package_matching_its_entry() {
        let root = temp_root("registry_ok");
        let bytes = package();
        let plugin = install_verified(&root, &entry_for(&bytes), &bytes).unwrap();
        assert_eq!(plugin.id, "com.x.pkg");
        assert!(root.join("com.x.pkg").join("main.js").is_file());
        // The hash is matched without regard to case, as the renderer did.
        let upper = RegistryEntry {
            sha256: sha256_hex(&bytes).to_uppercase(),
            ..entry_for(&bytes)
        };
        assert!(install_verified(&root, &upper, &bytes).is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn install_verified_writes_nothing_for_a_package_with_another_hash() {
        let root = temp_root("registry_hash");
        let bytes = package();
        let entry = RegistryEntry {
            sha256: "0".repeat(64),
            ..entry_for(&bytes)
        };
        let err = install_verified(&root, &entry, &bytes).unwrap_err();
        assert!(err.contains("checksum mismatch"), "{err}");
        assert!(!root.join("com.x.pkg").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn install_verified_writes_nothing_for_a_package_naming_another_plugin() {
        let root = temp_root("registry_id");
        // The entry the user consented to is a different plugin, which is
        // already installed: the package must not land on it.
        write_plugin(
            &root.join("com.x.pkg"),
            "com.x.pkg",
            "export default { real: true };",
        );
        let bytes = package();
        let entry = RegistryEntry {
            id: "com.x.other".into(),
            ..entry_for(&bytes)
        };
        let err = install_verified(&root, &entry, &bytes).unwrap_err();
        assert!(err.contains("declares manifest id com.x.pkg"), "{err}");
        assert!(!root.join("com.x.other").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("com.x.pkg").join("main.js")).unwrap(),
            "export default { real: true };"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn install_verified_refuses_a_core_plugin_id_before_hashing() {
        let root = temp_root("registry_core");
        let bytes = package();
        let entry = RegistryEntry {
            id: "glyph.core.mermaid".into(),
            ..entry_for(&bytes)
        };
        assert!(install_verified(&root, &entry, &bytes).is_err());
        assert!(!root.join("glyph.core.mermaid").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn marketplace_urls_are_the_registry_org_and_github_asset_hosts() {
        for url in [
            "https://raw.githubusercontent.com/glyph-md/plugins/main/index.json",
            "https://github.com/glyph-md/x/releases/download/v1/x.zip",
            "https://release-assets.githubusercontent.com/github-production-release-asset/1",
            "https://objects.githubusercontent.com/github-production-release-asset/1",
        ] {
            assert!(is_marketplace_url(url), "{url}");
        }
        for url in [
            "https://raw.githubusercontent.com/other/plugins/main/index.json",
            "https://github.com/glyph-md.attacker.example/x.zip",
            "http://github.com/glyph-md/x.zip",
            "https://objects.githubusercontent.com.attacker.example/x",
            // Resolved before it is judged: the client would fetch /other/.
            "https://github.com/glyph-md/../other/x.zip",
            "https://github.com/glyph-md/%2E%2E/other/x.zip",
            "https://github.com@attacker.example/glyph-md/x.zip",
            "https://github.com:8443/glyph-md/x.zip",
            "https://github.com/glyph-md",
            "not a url",
        ] {
            assert!(!is_marketplace_url(url), "{url}");
        }
    }
}
