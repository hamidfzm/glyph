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
        // Defensive: requires a running ssh-agent on the host. CI hosts
        // don't have one, so this arm isn't covered by the unit tests.
        // Manual verification with `eval "$(ssh-agent)"; ssh-add` + a
        // git@ remote is the validation path. The follow-up OS-keychain
        // PR will replace this with a stored-key flow.
        let user = username_from_url.unwrap_or("git");
        return git2::Cred::ssh_key_from_agent(user);
    }
    git2::Cred::default()
}
