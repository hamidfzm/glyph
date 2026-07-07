// User stylesheet support: a single `custom.css` in the app config dir that
// the frontend injects after its own styles when the setting is on. Reading
// and creating go through these commands so the webview never touches the
// filesystem directly.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const FILE_NAME: &str = "custom.css";

const STARTER: &str = "/* Glyph custom stylesheet.\n\
 * Loaded after the app's own styles when Settings > Appearance > Custom CSS\n\
 * is on. Style the document with `.markdown-body` selectors, e.g.:\n\
 *\n\
 * .markdown-body { letter-spacing: 0.01em; }\n\
 */\n";

fn css_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// Read the stylesheet; `Ok(None)` when the user never created one.
fn read_from(config_dir: &Path) -> Result<Option<String>, String> {
    let path = css_path(config_dir);
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))
}

/// Create the stylesheet with a starter comment if missing; return its path.
fn ensure_at(config_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(config_dir)
        .map_err(|e| format!("cannot create {}: {e}", config_dir.display()))?;
    let path = css_path(config_dir);
    if !path.is_file() {
        fs::write(&path, STARTER).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    }
    Ok(path)
}

fn config_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve app config dir: {e}"))
}

#[tauri::command]
pub fn read_custom_css<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<String>, String> {
    read_from(&config_dir(&app)?)
}

#[tauri::command]
pub fn ensure_custom_css<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    ensure_at(&config_dir(&app)?).map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("glyph_css_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_returns_none_when_file_is_missing() {
        let dir = temp_dir("missing");
        assert_eq!(read_from(&dir).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_creates_the_starter_then_read_round_trips() {
        let dir = temp_dir("roundtrip");
        let path = ensure_at(&dir).unwrap();
        assert!(path.is_file());
        let content = read_from(&dir).unwrap().unwrap();
        assert!(content.contains("Glyph custom stylesheet"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_does_not_overwrite_an_existing_file() {
        let dir = temp_dir("keep");
        fs::write(css_path(&dir), "body { color: red }").unwrap();
        ensure_at(&dir).unwrap();
        assert_eq!(read_from(&dir).unwrap().unwrap(), "body { color: red }");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn commands_run_against_a_mock_app() {
        use tauri::test::mock_app;
        let app = mock_app();
        let path = ensure_custom_css(app.handle().clone()).unwrap();
        assert!(read_custom_css(app.handle().clone()).unwrap().is_some());
        // Clean up what we wrote into the mock app's config dir.
        let _ = fs::remove_file(path);
    }
}
