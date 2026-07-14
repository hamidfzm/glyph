//! Webview-facing surface of the secret manager. Accounts the frontend may
//! touch are allowlisted so a compromised renderer can't probe arbitrary
//! keychain entries; backend-only secrets (sync tokens) never appear here and
//! are reached through `crate::secrets` directly.

use crate::secrets;

/// Accounts the webview is allowed to read and write.
const WEBVIEW_ACCOUNTS: &[&str] = &["ai-api-key-claude", "ai-api-key-openai"];

fn validate(name: &str) -> Result<(), String> {
    if WEBVIEW_ACCOUNTS.contains(&name) {
        return Ok(());
    }
    Err(format!("unknown secret: {name}"))
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    validate(&name)?;
    secrets::get(&name)
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    validate(&name)?;
    secrets::set(&name, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::test_store;

    #[test]
    fn rejects_accounts_outside_the_allowlist() {
        let _guard = test_store::install();
        // Backend-only and arbitrary names must be refused before any
        // keychain access, sync tokens included.
        for name in ["sync-token-/w", "ai-api-key-ollama", "../etc/passwd", ""] {
            assert!(secret_get(name.into()).is_err());
            assert!(secret_set(name.into(), "x".into()).is_err());
        }
        let err = secret_get("bogus".into()).unwrap_err();
        assert!(err.contains("unknown secret"));
    }

    #[test]
    fn round_trips_an_allowlisted_secret() {
        let _guard = test_store::install();
        assert_eq!(secret_get("ai-api-key-claude".into()).unwrap(), None);

        secret_set("ai-api-key-claude".into(), "sk-live".into()).unwrap();
        assert_eq!(
            secret_get("ai-api-key-claude".into()).unwrap(),
            Some("sk-live".into())
        );

        // The empty string clears the entry; clearing twice stays Ok.
        secret_set("ai-api-key-claude".into(), String::new()).unwrap();
        secret_set("ai-api-key-claude".into(), String::new()).unwrap();
        assert_eq!(secret_get("ai-api-key-claude".into()).unwrap(), None);
    }
}
