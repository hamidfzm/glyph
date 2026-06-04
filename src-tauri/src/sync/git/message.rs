use git2::Repository;

use crate::sync::SyncError;

use super::AUTO_COMMIT_MESSAGE;

/// Generate a GitHub-style commit subject from the diff between HEAD
/// and the current index. Mirrors what GitHub's web editor produces
/// when you commit through the file browser:
///
/// - one add/delete/modify: `Create|Delete|Update <basename>`
/// - two or three deltas: `Create|Delete|Update a, b[, c]` (verb
///   matches when all deltas are the same kind, falls back to `Update`)
/// - four or more: `Create|Delete|Update first, second and N more files`
///
/// Falls back to the legacy `AUTO_COMMIT_MESSAGE` when libgit2 reports
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
        return Ok(AUTO_COMMIT_MESSAGE.to_string());
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
