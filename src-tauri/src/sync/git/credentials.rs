/// A token and the `https://` authority (host, with its port when the URL
/// names one) it was entered for. The callback hands the token to that
/// authority alone: the remote URL comes from `.git/config`, which the
/// renderer can point anywhere through `sync_set_origin`, and a token sent
/// to whatever host that names would reach an attacker's server.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BoundToken {
    pub token: String,
    pub host: String,
}

/// The authority of an `https://` URL, lowercased. `None` for any other
/// scheme and for a URL carrying credentials: a token is bound to neither.
pub fn https_authority(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    Some(authority.to_ascii_lowercase())
}

/// Build the FnMut closure libgit2 hands to `credentials()`. Returns
/// `impl FnMut` directly so it's reusable from fetch/push and
/// clone, and the body is reachable from tests (call the returned
/// closure with synthetic args). The token is offered only for the
/// authority it is bound to; any other URL gets the tokenless path.
pub fn make_credentials_callback(
    token: Option<BoundToken>,
) -> impl FnMut(&str, Option<&str>, git2::CredentialType) -> Result<git2::Cred, git2::Error> {
    move |url, username_from_url, allowed| {
        let authority = https_authority(url);
        let token = token
            .as_ref()
            .filter(|bound| authority.as_deref() == Some(bound.host.as_str()))
            .map(|bound| bound.token.as_str());
        select_credentials(allowed, username_from_url, token)
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

    fn bound(host: &str) -> Option<BoundToken> {
        Some(BoundToken {
            token: "ghp_xyz".into(),
            host: host.into(),
        })
    }

    #[test]
    fn make_credentials_callback_forwards_to_select_credentials() {
        // The closure body is one call to `select_credentials`; we
        // exercise it directly with synthetic args so the closure lines
        // get coverage even without an authenticated remote handshake.
        let mut cb = make_credentials_callback(bound("example.com"));
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

    /// The token goes to the host it was entered for and nowhere else: not
    /// to another host, a subdomain, the same name over another scheme, a
    /// URL smuggling the host into its userinfo, or one that adds a port.
    #[test]
    fn the_token_is_offered_only_to_the_host_it_is_bound_to() {
        for url in [
            "https://attacker.example/repo.git",
            "https://example.com.attacker.example/repo.git",
            "https://sub.example.com/repo.git",
            "http://example.com/repo.git",
            "https://example.com@attacker.example/repo.git",
            "https://example.com:8443/repo.git",
            "ssh://example.com/repo.git",
            "example.com",
        ] {
            let mut cb = make_credentials_callback(bound("example.com"));
            let cred = cb(url, None, git2::CredentialType::USER_PASS_PLAINTEXT).unwrap();
            assert!(cred_has(&cred, git2::CredentialType::DEFAULT), "{url}");
            assert!(
                !cred_has(&cred, git2::CredentialType::USER_PASS_PLAINTEXT),
                "{url}"
            );
        }
        // The host is matched without regard to case, and with its port.
        for (host, url) in [
            ("example.com", "https://EXAMPLE.com/repo.git"),
            ("example.com:8443", "https://example.com:8443/repo.git"),
        ] {
            let mut cb = make_credentials_callback(bound(host));
            let cred = cb(url, None, git2::CredentialType::USER_PASS_PLAINTEXT).unwrap();
            assert!(
                cred_has(&cred, git2::CredentialType::USER_PASS_PLAINTEXT),
                "{url}"
            );
        }
        // A token bound to no host (entered before a remote existed) is
        // offered to no one.
        let mut cb = make_credentials_callback(bound(""));
        let cred = cb(
            "https://example.com/repo.git",
            None,
            git2::CredentialType::USER_PASS_PLAINTEXT,
        )
        .unwrap();
        assert!(cred_has(&cred, git2::CredentialType::DEFAULT));
    }

    #[test]
    fn https_authority_reads_https_urls_only() {
        assert_eq!(
            https_authority("https://Example.com:8443/o/r.git?x#y").as_deref(),
            Some("example.com:8443")
        );
        assert_eq!(
            https_authority("https://example.com").as_deref(),
            Some("example.com")
        );
        for url in [
            "http://example.com/r.git",
            "ssh://git@example.com/r.git",
            "git@example.com:o/r.git",
            "https://",
            "https:///r.git",
            "https://user:token@example.com/r.git",
        ] {
            assert!(https_authority(url).is_none(), "{url}");
        }
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
