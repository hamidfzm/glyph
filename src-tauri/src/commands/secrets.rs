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

/// Whether a secret is stored, without moving the value across the IPC
/// boundary. The Settings audit view uses this so listing what is saved
/// never hands the renderer a key it doesn't need.
#[tauri::command]
pub fn secret_has(name: String) -> Result<bool, String> {
    validate(&name)?;
    Ok(secrets::get(&name)?.is_some())
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
            assert!(secret_has(name.into()).is_err());
        }
        let err = secret_get("bogus".into()).unwrap_err();
        assert!(err.contains("unknown secret"));
        let err = secret_has("bogus".into()).unwrap_err();
        assert!(err.contains("unknown secret"));
    }

    #[test]
    fn reports_presence_per_account_without_the_value() {
        let _guard = test_store::install();
        secret_set("ai-api-key-claude".into(), String::new()).unwrap();
        secret_set("ai-api-key-openai".into(), String::new()).unwrap();
        assert!(!secret_has("ai-api-key-claude".into()).unwrap());

        secret_set("ai-api-key-claude".into(), "sk-live".into()).unwrap();
        assert!(secret_has("ai-api-key-claude".into()).unwrap());
        // Slots are independent: one key being set says nothing about another.
        assert!(!secret_has("ai-api-key-openai".into()).unwrap());

        secret_set("ai-api-key-claude".into(), String::new()).unwrap();
        assert!(!secret_has("ai-api-key-claude".into()).unwrap());
    }

    #[test]
    fn a_broken_keychain_errors_instead_of_reporting_absence() {
        let _guard = test_store::install();
        test_store::set_error("ai-api-key-openai", "keyring locked");

        let err = secret_has("ai-api-key-openai".into()).unwrap_err();
        assert!(err.starts_with("keychain read failed:"));

        test_store::clear_error("ai-api-key-openai");
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
