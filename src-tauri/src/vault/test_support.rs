//! The shared fixture vault. `src-tauri/fixtures/vault/` is a real workspace
//! checked into the repo and copied into a temp directory per test, so a test
//! may create, edit and delete inside it. `fixtures/vault-frontmatter.json`
//! carries the frontmatter expectations that `src/lib/frontmatter.test.ts`
//! asserts too, which is what keeps the two parsers in step.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::test::{mock_app, MockRuntime};
use tauri::Manager;

use crate::grants::GrantRegistry;
use crate::vault::commands::VaultStore;

pub(crate) fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// An empty temp directory, unique per test.
pub(crate) fn unique_tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "glyph_vault_{}_{}_{}",
        name,
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A writable copy of the fixture vault.
pub(crate) fn fixture_vault(name: &str) -> PathBuf {
    let dir = unique_tmp(name);
    copy_tree(&fixtures_dir().join("vault"), &dir);
    dir
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A mock app carrying a grant for `dir` plus an empty vault store, so the
/// command surface runs without a real window manager.
pub(crate) fn app_with_workspace(dir: &Path) -> tauri::App<MockRuntime> {
    let app = mock_app();
    app.manage(GrantRegistry::default());
    app.manage(VaultStore::default());
    app.state::<GrantRegistry>().grant_workspace(dir).unwrap();
    app
}

/// A mock app with no grant at all, for the denial tests.
pub(crate) fn app_without_grants() -> tauri::App<MockRuntime> {
    let app = mock_app();
    app.manage(GrantRegistry::default());
    app.manage(VaultStore::default());
    app
}

/// Fixture paths as the index spells them, relative to `root`.
pub(crate) fn in_vault(root: &Path, relative: &str) -> String {
    relative
        .split('/')
        .fold(root.to_path_buf(), |path, segment| path.join(segment))
        .to_string_lossy()
        .to_string()
}
