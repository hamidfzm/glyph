//! Secret storage in the OS credential manager (macOS Keychain, Windows
//! Credential Manager, Linux Secret Service). One keychain service, namespaced
//! accounts: AI provider keys use `ai-api-key-<provider>`, sync tokens use
//! `sync-token-<workspace path>`. Secrets never touch settings.json or any
//! other on-disk store, and error strings must never contain the value.

use keyring::Entry;

/// Keychain service name, matching the bundle identifier.
const SERVICE: &str = "com.hamidfzm.glyph";

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("keychain unavailable: {e}"))
}

/// Read a stored secret. A missing entry is `None`, not an error, so callers
/// can distinguish "nothing saved" from "keychain broken".
pub fn get(account: &str) -> Result<Option<String>, String> {
    match entry_for(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read failed: {e}")),
    }
}

/// Write or clear a secret. The empty string deletes the entry, and deleting
/// an entry that doesn't exist is a no-op.
pub fn set(account: &str, value: &str) -> Result<(), String> {
    let entry = entry_for(account)?;
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

/// Shared in-memory credential store for tests. keyring's own mock keeps each
/// `Entry` isolated, so a set through one command would never be visible to a
/// get through another; this store shares state per service/account the way
/// the real OS stores do. Entries can be primed with an error to exercise the
/// failure arms.
#[cfg(test)]
pub mod test_store {
    use keyring::credential::{Credential, CredentialApi, CredentialBuilder, CredentialBuilderApi};
    use std::collections::HashMap;
    use std::sync::{Mutex, MutexGuard, Once, OnceLock};

    fn store() -> &'static Mutex<HashMap<String, String>> {
        static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        STORE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn errors() -> &'static Mutex<HashMap<String, String>> {
        static ERRORS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        ERRORS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// Make every operation on `account` fail with `message` until cleared
    /// with [`clear_error`].
    pub fn set_error(account: &str, message: &str) {
        errors()
            .lock()
            .unwrap()
            .insert(account.to_string(), message.to_string());
    }

    pub fn clear_error(account: &str) {
        errors().lock().unwrap().remove(account);
    }

    #[derive(Debug)]
    struct MemCredential {
        key: String,
        account: String,
    }

    impl MemCredential {
        fn check_error(&self) -> keyring::Result<()> {
            if let Some(msg) = errors().lock().unwrap().get(&self.account) {
                return Err(keyring::Error::Invalid("test".into(), msg.clone()));
            }
            Ok(())
        }
    }

    impl CredentialApi for MemCredential {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            self.check_error()?;
            let value = String::from_utf8(secret.to_vec())
                .map_err(|e| keyring::Error::Invalid("secret".into(), e.to_string()))?;
            store().lock().unwrap().insert(self.key.clone(), value);
            Ok(())
        }

        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            self.check_error()?;
            match store().lock().unwrap().get(&self.key) {
                Some(value) => Ok(value.clone().into_bytes()),
                None => Err(keyring::Error::NoEntry),
            }
        }

        fn delete_credential(&self) -> keyring::Result<()> {
            self.check_error()?;
            match store().lock().unwrap().remove(&self.key) {
                Some(_) => Ok(()),
                None => Err(keyring::Error::NoEntry),
            }
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    #[derive(Debug)]
    struct MemBuilder;

    impl CredentialBuilderApi for MemBuilder {
        fn build(
            &self,
            _target: Option<&str>,
            service: &str,
            user: &str,
        ) -> keyring::Result<Box<Credential>> {
            // Reserved account for exercising the "keychain unavailable" arm,
            // where the entry itself cannot be constructed.
            if user == "test-unbuildable" {
                return Err(keyring::Error::Invalid("test".into(), "no store".into()));
            }
            Ok(Box::new(MemCredential {
                key: format!("{service}/{user}"),
                account: user.to_string(),
            }))
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    /// Install the shared store as the process-wide credential builder and
    /// return a guard serializing keychain tests (they share global state).
    pub fn install() -> MutexGuard<'static, ()> {
        static INIT: Once = Once::new();
        static LOCK: Mutex<()> = Mutex::new(());
        INIT.call_once(|| {
            let builder: Box<CredentialBuilder> = Box::new(MemBuilder);
            keyring::set_default_credential_builder(builder);
        });
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_secret_across_separate_operations() {
        let _guard = test_store::install();
        assert_eq!(get("test-round-trip").unwrap(), None);

        set("test-round-trip", "s3cret").unwrap();
        assert_eq!(get("test-round-trip").unwrap(), Some("s3cret".into()));

        // The empty string clears the credential.
        set("test-round-trip", "").unwrap();
        assert_eq!(get("test-round-trip").unwrap(), None);
    }

    #[test]
    fn clearing_a_missing_entry_is_a_no_op() {
        let _guard = test_store::install();
        set("test-clear-missing", "").unwrap();
    }

    #[test]
    fn an_unconstructible_entry_reports_the_keychain_unavailable() {
        let _guard = test_store::install();
        let err = get("test-unbuildable").unwrap_err();
        assert!(err.starts_with("keychain unavailable:"));
        let err = set("test-unbuildable", "x").unwrap_err();
        assert!(err.starts_with("keychain unavailable:"));
    }

    #[test]
    fn failures_map_to_prefixed_errors_without_the_value() {
        let _guard = test_store::install();
        test_store::set_error("test-broken", "keyring locked");

        let err = get("test-broken").unwrap_err();
        assert!(err.starts_with("keychain read failed:"));

        let err = set("test-broken", "s3cret").unwrap_err();
        assert!(err.starts_with("keychain write failed:"));
        assert!(!err.contains("s3cret"));

        let err = set("test-broken", "").unwrap_err();
        assert!(err.starts_with("keychain delete failed:"));

        test_store::clear_error("test-broken");
    }
}
