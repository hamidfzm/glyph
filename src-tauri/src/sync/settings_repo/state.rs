//! Process-lifetime state of the settings repo: the lock that keeps two
//! operations off the clone at once, and the token it pushes with.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::sync::git::BoundToken;
use crate::sync::SyncError;

/// Keychain accounts for the settings repo's token and the host it is bound
/// to. Fixed names, apart from the workspace `sync-token-<path>` accounts and
/// off the webview secret allowlist.
const TOKEN_ACCOUNT: &str = "settings-sync-token";
const HOST_ACCOUNT: &str = "settings-sync-token-host";

/// Where the repo and the stores it reads live. Production resolves these
/// from the app; tests point them at a temp folder.
#[derive(Debug, Clone)]
pub(super) struct Locations {
    pub(super) app_data: PathBuf,
    pub(super) settings_store: PathBuf,
    pub(super) plugins_store: PathBuf,
    pub(super) plugins_root: PathBuf,
}

#[derive(Default)]
pub struct SettingsSyncState {
    lock: Arc<Mutex<()>>,
    token: Mutex<Option<BoundToken>>,
    locations: Option<Locations>,
}

impl SettingsSyncState {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub(super) fn at(locations: Locations) -> Self {
        Self {
            locations: Some(locations),
            ..Self::default()
        }
    }

    pub(super) fn locations(&self) -> Option<&Locations> {
        self.locations.as_ref()
    }

    /// A handle on the lock, for the blocking task that will hold it.
    pub(super) fn lock(&self) -> Arc<Mutex<()>> {
        Arc::clone(&self.lock)
    }

    /// Store a token bound to `host`. The keychain write is best-effort, as
    /// for workspace tokens: a locked keyring keeps the token for this
    /// session only instead of failing.
    pub(super) fn set_token(&self, token: String, host: String) {
        if let Err(e) = crate::secrets::set(TOKEN_ACCOUNT, &token) {
            eprintln!("settings sync: failed to store the token in the keychain: {e}");
        }
        if let Err(e) = crate::secrets::set(HOST_ACCOUNT, &host) {
            eprintln!("settings sync: failed to store the token's host in the keychain: {e}");
        }
        *self.token.lock().unwrap() = Some(BoundToken { token, host });
    }

    pub(super) fn token(&self) -> Option<BoundToken> {
        let mut cached = self.token.lock().unwrap();
        if cached.is_none() {
            let token = crate::secrets::get(TOKEN_ACCOUNT).ok().flatten()?;
            let host = crate::secrets::get(HOST_ACCOUNT).ok().flatten()?;
            *cached = Some(BoundToken { token, host });
        }
        cached.clone()
    }

    /// Whether a token is stored, never the token. A keychain failure is an
    /// error, not "nothing stored".
    pub(super) fn has_token(&self) -> Result<bool, SyncError> {
        if self.token.lock().unwrap().is_some() {
            return Ok(true);
        }
        crate::secrets::get(TOKEN_ACCOUNT)
            .map(|token| token.is_some())
            .map_err(SyncError::Backend)
    }

    pub(super) fn clear_token(&self) {
        for account in [TOKEN_ACCOUNT, HOST_ACCOUNT] {
            if let Err(e) = crate::secrets::set(account, "") {
                eprintln!("settings sync: failed to clear {account} from the keychain: {e}");
            }
        }
        *self.token.lock().unwrap() = None;
    }
}

/// Take the lock or report that another operation holds it. Refusing rather
/// than queueing means a disconnect never waits behind a long sync.
pub(super) fn try_hold(lock: &Mutex<()>) -> Result<MutexGuard<'_, ()>, SyncError> {
    lock.try_lock().map_err(|_| SyncError::Busy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_held_lock_refuses_a_second_operation() {
        let state = SettingsSyncState::new();
        let lock = state.lock();
        let held = try_hold(&lock).unwrap();
        assert!(matches!(try_hold(&lock), Err(SyncError::Busy)));
        drop(held);
        assert!(try_hold(&lock).is_ok());
    }

    #[test]
    fn a_token_round_trips_through_the_keychain_bound_to_its_host() {
        let _guard = crate::secrets::test_store::install();
        SettingsSyncState::new().clear_token();
        let state = SettingsSyncState::new();
        assert!(!state.has_token().unwrap());
        state.set_token("tok".into(), "example.com".into());

        // A fresh state (an app restart) reads it back from the keychain.
        let restarted = SettingsSyncState::new();
        assert!(restarted.has_token().unwrap());
        assert_eq!(
            restarted.token(),
            Some(BoundToken {
                token: "tok".into(),
                host: "example.com".into()
            })
        );

        restarted.clear_token();
        assert!(!SettingsSyncState::new().has_token().unwrap());
        assert_eq!(SettingsSyncState::new().token(), None);
    }

    #[test]
    fn a_keychain_failure_is_reported_not_read_as_nothing_stored() {
        let _guard = crate::secrets::test_store::install();
        SettingsSyncState::new().clear_token();
        crate::secrets::test_store::set_error(TOKEN_ACCOUNT, "locked");
        crate::secrets::test_store::set_error(HOST_ACCOUNT, "locked");
        let state = SettingsSyncState::new();
        assert!(state.has_token().is_err());
        // The token still works for this session.
        state.set_token("tok".into(), "example.com".into());
        assert!(state.has_token().unwrap());
        state.clear_token();
        crate::secrets::test_store::clear_error(TOKEN_ACCOUNT);
        crate::secrets::test_store::clear_error(HOST_ACCOUNT);
    }
}
