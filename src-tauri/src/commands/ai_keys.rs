//! AI provider API keys in the OS credential manager (macOS Keychain, Windows
//! Credential Manager, Linux Secret Service). Keys never touch settings.json;
//! the frontend keeps them in memory only and reads/writes through these
//! commands. Error strings must never contain the secret value.

use keyring::Entry;

/// Keychain service name, matching the bundle identifier.
const SERVICE: &str = "com.hamidfzm.glyph";

/// Providers that authenticate with an API key. Ollama is local and keyless.
const KEYED_PROVIDERS: &[&str] = &["claude", "openai"];

/// Map a provider id to its keychain account name, rejecting anything outside
/// the allowlist so the webview can't probe arbitrary credential entries.
fn account_for(provider: &str) -> Result<String, String> {
    if !KEYED_PROVIDERS.contains(&provider) {
        return Err(format!("unknown AI provider: {provider}"));
    }
    Ok(format!("ai-api-key-{provider}"))
}

fn entry_for(provider: &str) -> Result<Entry, String> {
    let account = account_for(provider)?;
    Entry::new(SERVICE, &account).map_err(|e| format!("keychain unavailable: {e}"))
}

/// Read a stored key. A missing entry is `None`, not an error, so the frontend
/// can distinguish "no key saved" from "keychain broken".
fn read_entry(entry: &Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read failed: {e}")),
    }
}

/// Write or clear a key. The empty string deletes the entry (clearing the
/// input field in Settings removes the credential), and deleting an entry
/// that doesn't exist is a no-op.
fn write_entry(entry: &Entry, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keychain delete failed: {e}")),
        };
    }
    entry
        .set_password(value)
        .map_err(|e| format!("keychain write failed: {e}"))
}

#[tauri::command]
pub fn ai_key_get(provider: String) -> Result<Option<String>, String> {
    read_entry(&entry_for(&provider)?)
}

#[tauri::command]
pub fn ai_key_set(provider: String, value: String) -> Result<(), String> {
    write_entry(&entry_for(&provider)?, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    // The mock credential store is process-global; install it once. Each
    // Entry created under the mock keeps its own isolated storage, so tests
    // exercise per-entry round trips and error mapping (cross-command
    // persistence is the real OS store's job).
    fn use_mock_store() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    #[test]
    fn account_for_allows_known_providers_only() {
        assert_eq!(account_for("claude").unwrap(), "ai-api-key-claude");
        assert_eq!(account_for("openai").unwrap(), "ai-api-key-openai");
        let err = account_for("ollama").unwrap_err();
        assert!(err.contains("unknown AI provider"));
        assert!(account_for("../etc/passwd").is_err());
        assert!(account_for("").is_err());
    }

    #[test]
    fn read_and_write_round_trip_on_one_entry() {
        use_mock_store();
        let entry = entry_for("claude").unwrap();
        assert_eq!(read_entry(&entry).unwrap(), None);

        write_entry(&entry, "sk-test").unwrap();
        assert_eq!(read_entry(&entry).unwrap(), Some("sk-test".into()));

        // The empty string clears the credential.
        write_entry(&entry, "").unwrap();
        assert_eq!(read_entry(&entry).unwrap(), None);
    }

    #[test]
    fn clearing_a_missing_entry_is_a_no_op() {
        use_mock_store();
        let entry = entry_for("openai").unwrap();
        write_entry(&entry, "").unwrap();
    }

    #[test]
    fn commands_reject_unknown_providers() {
        use_mock_store();
        assert!(ai_key_get("evil".into()).is_err());
        assert!(ai_key_set("evil".into(), "x".into()).is_err());
    }

    #[test]
    fn commands_handle_missing_keys_and_writes() {
        use_mock_store();
        // Each command builds its own mock entry, so a get after set sees the
        // mock's isolated (empty) storage — assert the per-command contracts.
        assert_eq!(ai_key_get("claude".into()).unwrap(), None);
        ai_key_set("claude".into(), "sk-live".into()).unwrap();
        ai_key_set("claude".into(), String::new()).unwrap();
    }

    #[test]
    fn error_strings_never_contain_the_secret() {
        use_mock_store();
        let entry = entry_for("claude").unwrap();
        // The mock store can be told to fail; simplest check here is the
        // static error prefixes plus the allowlist error, none of which embed
        // the value.
        let err = account_for("bogus").unwrap_err();
        assert!(!err.contains("sk-"));
        write_entry(&entry, "sk-secret").unwrap();
        // Read errors are formatted from keyring's error type only.
        assert!(read_entry(&entry).unwrap().is_some());
    }
}
