// The network half of a marketplace install: the registry index and the
// package are fetched here, from the marketplace hosts alone, and handed to
// the verification in registry.rs. Where the registry lives and which hosts
// are allowed come from `Marketplace`, so a test can point them at a local
// server; the app manages the default.

use std::path::Path;

use tauri_plugin_http::reqwest;

use super::registry::{
    find_entry, install_verified, is_marketplace_url, MAX_INDEX_BYTES, MAX_PACKAGE_BYTES,
    REGISTRY_URL,
};
use super::InstalledPlugin;

pub struct Marketplace {
    pub(crate) registry_url: String,
    /// Whether a URL may be downloaded from, the registry and each redirect
    /// included.
    pub(crate) allows: fn(&str) -> bool,
}

impl Default for Marketplace {
    fn default() -> Self {
        Self {
            registry_url: REGISTRY_URL.to_string(),
            allows: is_marketplace_url,
        }
    }
}

/// Fetch the registry index, find `id` in it, download the package the entry
/// names, and install it once its bytes verify against the entry.
pub(crate) async fn install_from_registry(
    root: &Path,
    marketplace: &Marketplace,
    id: &str,
) -> Result<InstalledPlugin, String> {
    let client = client(marketplace.allows)?;
    let index = download(
        &client,
        marketplace,
        &marketplace.registry_url,
        MAX_INDEX_BYTES,
    )
    .await?;
    let index =
        String::from_utf8(index).map_err(|_| String::from("the plugin registry is not UTF-8"))?;
    let entry = find_entry(&index, id, marketplace.allows)?;
    let bytes = download(&client, marketplace, &entry.package_url, MAX_PACKAGE_BYTES).await?;
    let root = root.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || install_verified(&root, &entry, &bytes))
        .await
        .map_err(|e| format!("plugin install task failed: {e}"))?
}

/// An HTTP client that follows a redirect only onto an allowed host, the way
/// the http capability scoped the renderer's download before.
fn client(allows: fn(&str) -> bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if allows(attempt.url().as_str()) {
                attempt.follow()
            } else {
                attempt.error("redirect leaves the marketplace hosts")
            }
        }))
        .build()
        .map_err(|e| format!("cannot build the download client: {e}"))
}

/// Fetch `url` into memory, refusing a body over `cap` bytes as it streams.
async fn download(
    client: &reqwest::Client,
    marketplace: &Marketplace,
    url: &str,
    cap: usize,
) -> Result<Vec<u8>, String> {
    if !(marketplace.allows)(url) {
        return Err(format!("{url} is outside the marketplace hosts"));
    }
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download failed: {}", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download failed: {e}"))?
    {
        if bytes.len() + chunk.len() > cap {
            return Err(format!("download of {url} exceeds the size limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::super::registry::sha256_hex;
    use super::super::test_support::*;
    use super::*;

    fn local_only(url: &str) -> bool {
        url.starts_with("http://127.0.0.1:")
    }

    fn marketplace(server: &LocalServer, path: &str) -> Marketplace {
        Marketplace {
            registry_url: format!("{}{path}", server.url()),
            allows: local_only,
        }
    }

    fn package() -> Vec<u8> {
        zip_of(&[
            ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
            ("main.js", b"export default {};"),
            ("assets/data.txt", b"payload"),
        ])
    }

    fn index_naming(server: &LocalServer, path: &str, bytes: &[u8]) -> Response {
        ok(format!(
            r#"{{"plugins":[{{"id":"com.x.pkg","packageUrl":"{}{path}","sha256":"{}"}}]}}"#,
            server.url(),
            sha256_hex(bytes)
        )
        .into_bytes())
    }

    #[tokio::test]
    async fn installs_the_package_the_registry_names() {
        let bytes = package();
        let server = LocalServer::bind();
        let marketplace = marketplace(&server, "/index.json");
        let routes = vec![
            ("/index.json", index_naming(&server, "/pkg.zip", &bytes)),
            ("/pkg.zip", ok(bytes)),
        ];
        server.serve(routes);
        let root = temp_root("download_ok");
        let plugin = install_from_registry(&root, &marketplace, "com.x.pkg")
            .await
            .unwrap();
        assert_eq!(plugin.id, "com.x.pkg");
        assert!(root.join("com.x.pkg").join("assets/data.txt").is_file());
    }

    #[tokio::test]
    async fn follows_a_redirect_onto_an_allowed_host_only() {
        let bytes = package();
        let server = LocalServer::bind();
        let hopping = marketplace(&server, "/index.json");
        let leaving = marketplace(&server, "/out.json");
        let elsewhere = server.url().replace("127.0.0.1", "localhost");
        let routes = vec![
            ("/index.json", index_naming(&server, "/hop", &bytes)),
            ("/hop", redirect(&format!("{}/pkg.zip", server.url()))),
            ("/pkg.zip", ok(bytes.clone())),
            ("/out.json", index_naming(&server, "/leave", &bytes)),
            ("/leave", redirect(&format!("{elsewhere}/pkg.zip"))),
        ];
        server.serve(routes);
        let root = temp_root("download_redirect");
        let plugin = install_from_registry(&root, &hopping, "com.x.pkg")
            .await
            .unwrap();
        assert_eq!(plugin.id, "com.x.pkg");

        let err = install_from_registry(&root, &leaving, "com.x.pkg")
            .await
            .unwrap_err();
        assert!(err.contains("download failed"), "{err}");
    }

    #[tokio::test]
    async fn refuses_a_registry_outside_the_allowed_hosts_without_a_request() {
        let outside = Marketplace {
            registry_url: "http://localhost:1/index.json".into(),
            allows: local_only,
        };
        let err = install_from_registry(Path::new("/nonexistent"), &outside, "com.x.pkg")
            .await
            .unwrap_err();
        assert_eq!(
            err,
            "http://localhost:1/index.json is outside the marketplace hosts"
        );
    }

    #[tokio::test]
    async fn reports_a_failed_status_a_bad_encoding_and_an_oversized_body() {
        let bytes = package();
        let server = LocalServer::bind();
        let cases = [
            ("/missing.json", "download failed: 404 Not Found"),
            ("/latin1.json", "the plugin registry is not UTF-8"),
            ("/big.json", "exceeds the size limit"),
        ]
        .map(|(path, expected)| (marketplace(&server, path), path, expected));
        let routes = vec![
            (
                "/missing.json",
                Response {
                    status: 404,
                    location: None,
                    body: Vec::new(),
                },
            ),
            ("/latin1.json", ok(vec![0xff, 0xfe])),
            ("/big.json", index_naming(&server, "/big.zip", &bytes)),
            ("/big.zip", ok(vec![0; MAX_PACKAGE_BYTES + 1])),
        ];
        server.serve(routes);
        let root = temp_root("download_errors");
        for (marketplace, path, expected) in &cases {
            let err = install_from_registry(&root, marketplace, "com.x.pkg")
                .await
                .unwrap_err();
            assert!(err.contains(expected), "{path}: {err}");
        }
        assert!(!root.join("com.x.pkg").exists());
    }

    #[test]
    fn the_default_marketplace_is_the_published_registry() {
        let marketplace = Marketplace::default();
        assert_eq!(marketplace.registry_url, REGISTRY_URL);
        assert!((marketplace.allows)(
            "https://github.com/glyph-md/x/releases/a.zip"
        ));
        assert!(!(marketplace.allows)("http://127.0.0.1:8080/a.zip"));
    }
}
