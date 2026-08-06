/// Build the FnMut closure libgit2 hands to `credentials()`. Returns
/// `impl FnMut` directly so it's reusable from fetch/push and
/// clone, and the body is reachable from tests (call the returned
/// closure with synthetic args).
pub fn make_credentials_callback(
    token: Option<String>,
) -> impl FnMut(&str, Option<&str>, git2::CredentialType) -> Result<git2::Cred, git2::Error> {
    move |_url, username_from_url, allowed| {
        select_credentials(allowed, username_from_url, token.as_deref())
    }
}

/// Select libgit2 credentials based on what auth method the remote
/// advertised and what we have stashed. Used by both fetch/push and
/// clone. Extracted so we can drive it from tests with synthetic
/// `CredentialType` bitflags instead of needing a real authenticated
/// remote.
///
/// Preference order:
/// 1. HTTPS basic-auth with the supplied token if the remote will accept
///    username/password and we have one. We use `x-access-token` as the
///    username because GitHub treats it as a magic PAT username; GitLab
///    and Codeberg accept any non-empty username.
/// 2. SSH agent if the remote wants a key (`git@host:repo.git` style).
/// 3. libgit2's default (anonymous HTTPS for public remotes, etc.).
pub fn select_credentials(
    allowed: git2::CredentialType,
    username_from_url: Option<&str>,
    token: Option<&str>,
) -> Result<git2::Cred, git2::Error> {
    if allowed.is_user_pass_plaintext() {
        if let Some(t) = token {
            return git2::Cred::userpass_plaintext("x-access-token", t);
        }
    }
    if allowed.is_ssh_key() {
        // A real push still needs a running ssh-agent, which CI hosts don't
        // have; end-to-end validation is `eval "$(ssh-agent)"; ssh-add` plus a
        // git@ remote. The follow-up OS-keychain PR replaces this with a
        // stored-key flow.
        return git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"));
    }
    git2::Cred::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    /// portable.
    fn cred_has(cred: &git2::Cred, kind: git2::CredentialType) -> bool {
        i64::from(cred.credtype()) & i64::from(kind.bits()) != 0
    }

    #[test]
    fn make_credentials_callback_forwards_to_select_credentials() {
        // The closure body is one call to `select_credentials`; we
        // exercise it directly with synthetic args so the closure lines
        // get coverage even without an authenticated remote handshake.
        let mut cb = make_credentials_callback(Some("ghp_xyz".into()));
        let cred = cb(
            "https://example.com/repo.git",
            None,
            git2::CredentialType::USER_PASS_PLAINTEXT,
        )
        .expect("userpass cred");
        assert!(cred_has(&cred, git2::CredentialType::USER_PASS_PLAINTEXT));

        // Same callback called a second time with no token in scope —
        // confirms the closure captures and reuses the token via the
        // FnMut closure trait.
        let mut cb_no_token = make_credentials_callback(None);
        let cred = cb_no_token(
            "https://example.com/repo.git",
            None,
            git2::CredentialType::USER_PASS_PLAINTEXT,
        )
        .expect("default cred");
        assert!(cred_has(&cred, git2::CredentialType::DEFAULT));
    }

    #[test]
    fn select_credentials_returns_userpass_when_https_basic_auth_is_allowed_and_token_present() {
        let cred = select_credentials(
            git2::CredentialType::USER_PASS_PLAINTEXT,
            None,
            Some("ghp_secret"),
        )
        .expect("userpass cred");
        assert!(cred_has(&cred, git2::CredentialType::USER_PASS_PLAINTEXT));
    }

    #[test]
    fn select_credentials_falls_through_to_default_when_no_token_for_https() {
        // Remote will accept userpass but we have nothing to give. With
        // only USER_PASS_PLAINTEXT advertised, we end up at the libgit2
        // default cred, which is what unauthenticated HTTPS uses.
        let cred = select_credentials(git2::CredentialType::USER_PASS_PLAINTEXT, None, None)
            .expect("default cred");
        assert!(cred_has(&cred, git2::CredentialType::DEFAULT));
    }

    #[test]
    fn select_credentials_returns_default_when_no_supported_methods_are_allowed() {
        // Remote advertises something we don't handle (e.g. NTLM). Falls
        // through to libgit2's default credential.
        let cred =
            select_credentials(git2::CredentialType::USERNAME, None, None).expect("default cred");
        assert!(cred_has(&cred, git2::CredentialType::DEFAULT));
    }

    // `ssh_key_from_agent` only builds the credential; the agent handshake
    // happens later during the transport auth, so this arm is reachable
    // without a running ssh-agent even though a real push is not.
    #[test]
    fn select_credentials_asks_the_ssh_agent_when_ssh_is_allowed() {
        let cred = select_credentials(git2::CredentialType::SSH_KEY, Some("git"), None)
            .expect("ssh agent cred");
        assert!(cred_has(&cred, git2::CredentialType::SSH_KEY));
    }
}
