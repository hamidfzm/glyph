use git2::Repository;

use crate::sync::SyncError;

use super::auto_commit_fallback_message;

/// Generate a GitHub-style commit subject from the diff between HEAD
/// and the current index. Mirrors what GitHub's web editor produces
/// when you commit through the file browser:
///
/// - one add/delete/modify: `Create|Delete|Update <basename>`
/// - two or three deltas: `Create|Delete|Update a, b[, c]` (verb
///   matches when all deltas are the same kind, falls back to `Update`)
/// - four or more: `Create|Delete|Update first, second and N more files`
///
/// Falls back to [`auto_commit_fallback_message`] when libgit2 reports
/// no deltas (e.g. an unexpected state where the index didn't actually
/// move). Callers only invoke this when `stage_all` returned `true`, so
/// that path is defensive.
pub fn auto_commit_message(repo: &Repository) -> Result<String, SyncError> {
    let index = repo
        .index()
        .map_err(|e| SyncError::Backend(e.message().to_string()))?;

    // The diff source: index relative to HEAD's tree, or relative to no
    // tree at all on an unborn branch (every path becomes an Added).
    let head_tree = match repo.head() {
        Ok(head) => Some(
            head.peel_to_tree()
                .map_err(|e| SyncError::Backend(e.message().to_string()))?,
        ),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
        Err(e) => return Err(SyncError::Backend(e.message().to_string())),
    };
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), Some(&index), None)
        .map_err(|e| SyncError::Backend(e.message().to_string()))?;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Kind {
        Added,
        Deleted,
        Modified,
    }

    let mut entries: Vec<(Kind, String)> = Vec::new();
    for delta in diff.deltas() {
        let kind = match delta.status() {
            git2::Delta::Added | git2::Delta::Copied | git2::Delta::Untracked => Kind::Added,
            git2::Delta::Deleted => Kind::Deleted,
            // Modified / Renamed / Typechange / anything else with content
            // changes are presented as "Update".
            _ => Kind::Modified,
        };
        // Prefer the new path; fall back to the old path for deletes.
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().into_owned());
        if let Some(p) = path {
            entries.push((kind, p));
        }
    }

    if entries.is_empty() {
        return Ok(auto_commit_fallback_message());
    }

    let all_added = entries.iter().all(|(k, _)| *k == Kind::Added);
    let all_deleted = entries.iter().all(|(k, _)| *k == Kind::Deleted);
    let verb = if all_added {
        "Create"
    } else if all_deleted {
        "Delete"
    } else {
        "Update"
    };

    let names: Vec<&str> = entries.iter().map(|(_, n)| n.as_str()).collect();
    let msg = match names.as_slice() {
        [one] => format!("{verb} {one}"),
        [a, b] => format!("{verb} {a}, {b}"),
        [a, b, c] => format!("{verb} {a}, {b}, {c}"),
        many => {
            let rest = many.len() - 2;
            format!("{verb} {}, {} and {rest} more files", many[0], many[1])
        }
    };
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use git2::Repository;
    use tempfile::TempDir;

    use super::super::backend::GitBackend;
    use super::super::repo::init_repo;
    use super::super::test_support::Fixture;
    use super::auto_commit_message;
    use crate::sync::SyncBackend;
    /// returning the message `auto_commit_message` would produce.
    fn auto_message_for(f: &Fixture) -> String {
        let repo = Repository::open(&f.workspace).unwrap();
        GitBackend::stage_all(&repo).unwrap();
        auto_commit_message(&repo).unwrap()
    }

    #[test]
    fn auto_commit_message_for_a_single_added_file_says_create() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hi\n");
        assert_eq!(auto_message_for(&f), "Create notes.md");
    }

    #[test]
    fn auto_commit_message_on_unborn_branch_treats_paths_as_added() {
        // No HEAD yet — the diff source is `None`, so libgit2 marks
        // every index entry as `Added`. Two new files: "Create a, b".
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path();
        init_repo(workspace, crate::sync::DEFAULT_REMOTE_BRANCH).unwrap();
        fs::write(workspace.join("a.md"), "a").unwrap();
        fs::write(workspace.join("b.md"), "b").unwrap();
        let repo = Repository::open(workspace).unwrap();
        GitBackend::stage_all(&repo).unwrap();
        assert_eq!(auto_commit_message(&repo).unwrap(), "Create a.md, b.md");
    }

    #[test]
    fn auto_commit_message_for_a_single_deleted_file_says_delete() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hi\n");
        f.backend().sync(None).unwrap();
        fs::remove_file(f.workspace.join("notes.md")).unwrap();
        assert_eq!(auto_message_for(&f), "Delete notes.md");
    }

    #[test]
    fn auto_commit_message_for_a_single_modified_file_says_update() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hi\n");
        f.backend().sync(None).unwrap();
        f.write_file("notes.md", "# changed\n");
        assert_eq!(auto_message_for(&f), "Update notes.md");
    }

    #[test]
    fn auto_commit_message_for_two_mixed_deltas_uses_update_with_a_comma() {
        // One add + one modify on top of a clean repo. Mixed kinds, so
        // the verb falls back to "Update".
        let f = Fixture::new();
        f.write_file("a.md", "a\n");
        f.backend().sync(None).unwrap();
        f.write_file("a.md", "changed\n");
        f.write_file("b.md", "b\n");
        let msg = auto_message_for(&f);
        // Order of deltas isn't part of the API contract.
        assert!(
            msg == "Update a.md, b.md" || msg == "Update b.md, a.md",
            "unexpected message: {msg}"
        );
    }

    #[test]
    fn auto_commit_message_for_three_added_files_lists_each_with_create() {
        let f = Fixture::new();
        f.write_file("seed.md", "seed\n");
        f.backend().sync(None).unwrap();
        f.write_file("a.md", "a\n");
        f.write_file("b.md", "b\n");
        f.write_file("c.md", "c\n");
        let msg = auto_message_for(&f);
        assert!(msg.starts_with("Create "), "got: {msg}");
        for name in ["a.md", "b.md", "c.md"] {
            assert!(msg.contains(name), "missing {name} in {msg}");
        }
    }

    #[test]
    fn auto_commit_message_falls_back_to_the_legacy_message_when_diff_is_empty() {
        // Defensive fallback path: `auto_commit_message` only runs after
        // `stage_all` flagged "something to commit", but if libgit2 ever
        // reports zero deltas (a clean diff against HEAD) the function
        // must still hand back a usable subject. Re-running it on a fresh
        // post-sync repo with no edits hits that path.
        let f = Fixture::new();
        f.write_file("notes.md", "# hi\n");
        f.backend().sync(None).unwrap();
        let repo = Repository::open(&f.workspace).unwrap();
        // No changes since the sync, so `diff_tree_to_index` is empty.
        let msg = auto_commit_message(&repo).unwrap();
        assert_eq!(msg, super::auto_commit_fallback_message());
    }

    #[test]
    fn auto_commit_message_for_four_plus_files_collapses_into_n_more() {
        let f = Fixture::new();
        f.write_file("seed.md", "seed\n");
        f.backend().sync(None).unwrap();
        for n in ["a.md", "b.md", "c.md", "d.md", "e.md"] {
            fs::write(f.workspace.join(n), "x\n").unwrap();
        }
        let msg = auto_message_for(&f);
        assert!(msg.starts_with("Create "), "got: {msg}");
        assert!(msg.contains(" and 3 more files"), "got: {msg}");
    }

    // A HEAD libgit2 can neither resolve nor call unborn: the summary has to
    // surface a Backend error rather than panic on a corrupt repository.
    #[test]
    fn corrupt_head_surfaces_a_backend_error() {
        let f = Fixture::new();
        f.write_file("note.md", "hello");
        fs::write(
            f.workspace.join(".git/HEAD"),
            "not a ref
",
        )
        .unwrap();
        let repo = Repository::open(&f.workspace).unwrap();
        assert!(auto_commit_message(&repo).is_err());
    }
}
