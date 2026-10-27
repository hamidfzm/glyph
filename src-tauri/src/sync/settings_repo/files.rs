//! The repo's files: reading what a commit holds, and writing this machine's
//! export into the working tree.
//!
//! Reads go through git's object store, never the working tree, so whatever
//! a remote sent is only ever bytes: a link, a submodule, an oversized blob
//! or a file that is not a JSON object is reported and left out. Writes touch
//! only the two fixed folders and refuse anything there that is not a plain
//! folder or file, since a remote decides what the working tree holds.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use git2::{ObjectType, Repository, Tree, TreeEntry};
use serde::Serialize;
use serde_json::Value;

use crate::sync::SyncError;

use super::local::Object;

pub(super) const SETTINGS_DIR: &str = "settings";
pub(super) const PLUGINS_DIR: &str = "plugins";
/// Far above any real settings group or plugin entry.
const MAX_FILE_BYTES: usize = 64 * 1024;
/// File modes of a regular file; a link is `0o120000`, a submodule `0o160000`.
const FILE_MODES: [i32; 2] = [0o100644, 0o100755];

/// Why a file of the repo was left out of an import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    /// A link, a submodule or a folder where a file belongs.
    NotAFile,
    /// A file where a folder belongs.
    NotAFolder,
    TooLarge,
    NotJson,
    NotAnObject,
    /// No group or plugin of that name.
    UnknownName,
    /// The same name again, in another letter case.
    DuplicateName,
    /// More plugin files than the import reads.
    TooMany,
    /// Valid JSON that is not a plugin entry.
    BadEntry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    pub reason: SkipReason,
}

/// The JSON objects one folder of a commit holds, keyed by file stem, and
/// the files left out of it. `present` names every accepted stem, read or
/// not: a file that is there but unreadable still counts as there.
#[derive(Debug, Default)]
pub(super) struct Folder {
    pub(super) files: BTreeMap<String, Object>,
    pub(super) present: BTreeSet<String>,
    pub(super) skipped: Vec<SkippedFile>,
}

/// The tree HEAD points at, or `None` before the first commit.
pub(super) fn head_tree(repo: &Repository) -> Result<Option<Tree<'_>>, SyncError> {
    match repo.head() {
        Ok(head) => head
            .peel_to_tree()
            .map(Some)
            .map_err(|e| SyncError::Backend(e.message().to_string())),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Ok(None),
        Err(e) => Err(SyncError::Backend(e.message().to_string())),
    }
}

/// Read every `<stem>.json` in `dir` of `tree` whose stem `accept` takes, at
/// most `limit` of them, matching stems without regard to letter case.
pub(super) fn read_folder(
    repo: &Repository,
    tree: Option<&Tree<'_>>,
    dir: &str,
    accept: impl Fn(&str) -> bool,
    limit: usize,
) -> Folder {
    let mut folder = Folder::default();
    let Some(entry) = tree.and_then(|t| t.get_path(Path::new(dir)).ok()) else {
        return folder;
    };
    let subtree = (entry.kind() == Some(ObjectType::Tree))
        .then(|| repo.find_tree(entry.id()).ok())
        .flatten();
    let Some(subtree) = subtree else {
        folder.skip(dir.to_string(), SkipReason::NotAFolder);
        return folder;
    };
    let mut seen = BTreeSet::new();
    for item in subtree.iter() {
        let name = String::from_utf8_lossy(item.name_bytes()).into_owned();
        let path = format!("{dir}/{name}");
        let Some(stem) = name.strip_suffix(".json").filter(|stem| accept(stem)) else {
            folder.skip(path, SkipReason::UnknownName);
            continue;
        };
        // Every spelling counts as there, so a case variant beside a
        // plugin's file never reads as that plugin removed.
        folder.present.insert(stem.to_string());
        if !seen.insert(stem.to_ascii_lowercase()) {
            folder.skip(path, SkipReason::DuplicateName);
            continue;
        }
        if folder.files.len() >= limit {
            folder.skip(path, SkipReason::TooMany);
            continue;
        }
        match read_object(repo, &item) {
            Ok(object) => {
                folder.files.insert(stem.to_string(), object);
            }
            Err(reason) => folder.skip(path, reason),
        }
    }
    folder
}

impl Folder {
    fn skip(&mut self, path: String, reason: SkipReason) {
        self.skipped.push(SkippedFile { path, reason });
    }
}

fn read_object(repo: &Repository, item: &TreeEntry<'_>) -> Result<Object, SkipReason> {
    if item.kind() != Some(ObjectType::Blob) || !FILE_MODES.contains(&item.filemode()) {
        return Err(SkipReason::NotAFile);
    }
    // The header gives the size without reading the blob into memory.
    let (size, _) = repo
        .odb()
        .and_then(|odb| odb.read_header(item.id()))
        .map_err(|_| SkipReason::NotAFile)?;
    if size > MAX_FILE_BYTES {
        return Err(SkipReason::TooLarge);
    }
    let blob = repo
        .find_blob(item.id())
        .map_err(|_| SkipReason::NotAFile)?;
    match serde_json::from_slice::<Value>(blob.content()) {
        Ok(Value::Object(object)) => Ok(object),
        Ok(_) => Err(SkipReason::NotAnObject),
        Err(_) => Err(SkipReason::NotJson),
    }
}

/// Write `value` to `<dir>/<stem>.json` as sorted, pretty JSON ending in a
/// newline, so an unchanged export is byte-identical to the last one.
pub(super) fn write_object(
    repo_dir: &Path,
    dir: &str,
    stem: &str,
    value: &Object,
) -> Result<(), SyncError> {
    let target = plain_folder(repo_dir, dir)?.join(format!("{stem}.json"));
    match fs::symlink_metadata(&target) {
        Ok(meta) if meta.file_type().is_symlink() => return Err(not_plain(&target)),
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&target)?,
        Ok(_) | Err(_) => {}
    }
    fs::write(&target, canonical_json(value))?;
    Ok(())
}

/// Remove `<dir>/<stem>.json`; a file that is already gone is fine.
pub(super) fn remove_object(repo_dir: &Path, dir: &str, stem: &str) -> Result<(), SyncError> {
    let folder = repo_dir.join(dir);
    match fs::symlink_metadata(&folder) {
        Ok(meta) if meta.file_type().is_symlink() => return Err(not_plain(&folder)),
        Ok(meta) if meta.is_dir() => {}
        // Missing, or a file in the folder's place: no entry to remove.
        _ => return Ok(()),
    }
    let target = folder.join(format!("{stem}.json"));
    match fs::symlink_metadata(&target) {
        Ok(meta) if meta.file_type().is_symlink() => Err(not_plain(&target)),
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&target).map_err(SyncError::from),
        Ok(_) => fs::remove_file(&target).map_err(SyncError::from),
        Err(_) => Ok(()),
    }
}

/// `repo_dir/dir`, created when missing. A link there is refused: a write
/// through it would land wherever it points. The clone never checks out a
/// link, so a plain file in the folder's place came from a remote and goes,
/// as does a folder where an entry belongs: either would block every export.
fn plain_folder(repo_dir: &Path, dir: &str) -> Result<PathBuf, SyncError> {
    let folder = repo_dir.join(dir);
    match fs::symlink_metadata(&folder) {
        Ok(meta) if meta.file_type().is_symlink() => return Err(not_plain(&folder)),
        Ok(meta) if meta.is_dir() => return Ok(folder),
        Ok(_) => fs::remove_file(&folder)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    fs::create_dir(&folder)?;
    Ok(folder)
}

fn not_plain(path: &Path) -> SyncError {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    SyncError::InvalidState(format!(
        "{name} in the settings repo is not a plain file or folder"
    ))
}

pub(super) fn canonical_json(value: &Object) -> Vec<u8> {
    let mut text = serde_json::to_string_pretty(&sorted(&Value::Object(value.clone())))
        .expect("a JSON value always serializes");
    text.push('\n');
    text.into_bytes()
}

/// `value` with every object's keys in order. Built in that order, so the
/// output is sorted whether or not `serde_json` keeps insertion order.
fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|k| (k.clone(), sorted(&map[k])))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::object;
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    /// A repo whose one commit holds `settings/` built by `fill`.
    fn repo_with(
        fill: impl FnOnce(&Repository, &mut git2::TreeBuilder<'_>),
    ) -> (TempDir, Repository) {
        let tmp = TempDir::new().unwrap();
        let repo = Repository::init(tmp.path()).unwrap();
        {
            let mut inner = repo.treebuilder(None).unwrap();
            fill(&repo, &mut inner);
            let inner_id = inner.write().unwrap();
            let mut root = repo.treebuilder(None).unwrap();
            root.insert(SETTINGS_DIR, inner_id, 0o040000).unwrap();
            let tree = repo.find_tree(root.write().unwrap()).unwrap();
            let sig = git2::Signature::now("t", "t@e.com").unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "m", &tree, &[])
                .unwrap();
        }
        (tmp, repo)
    }

    fn blob(repo: &Repository, text: &str) -> git2::Oid {
        repo.blob(text.as_bytes()).unwrap()
    }

    #[test]
    fn reads_json_objects_and_reports_everything_else() {
        let (_tmp, repo) = repo_with(|repo, tree| {
            let ok = blob(repo, r#"{"theme":"dark"}"#);
            tree.insert("appearance.json", ok, 0o100644).unwrap();
            tree.insert("APPEARANCE.json", ok, 0o100644).unwrap();
            tree.insert("editor.json", blob(repo, "[1]"), 0o100644)
                .unwrap();
            tree.insert("layout.json", blob(repo, "{nope"), 0o100644)
                .unwrap();
            tree.insert("print.json", ok, 0o120000).unwrap();
            let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_FILE_BYTES));
            tree.insert("markdown.json", blob(repo, &big), 0o100644)
                .unwrap();
            tree.insert("privacy.json", ok, 0o100644).unwrap();
            tree.insert("notes.txt", ok, 0o100644).unwrap();
        });
        let tree = head_tree(&repo).unwrap();
        let folder = read_folder(&repo, tree.as_ref(), SETTINGS_DIR, |s| s != "privacy", 10);

        assert_eq!(
            folder.files.keys().collect::<Vec<_>>(),
            ["APPEARANCE"],
            "the first of two case variants is read"
        );
        assert_eq!(
            folder.present.iter().collect::<Vec<_>>(),
            [
                "APPEARANCE",
                "appearance",
                "editor",
                "layout",
                "markdown",
                "print"
            ],
            "an unreadable file is still there"
        );
        let reasons: BTreeMap<String, SkipReason> = folder
            .skipped
            .into_iter()
            .map(|s| (s.path, s.reason))
            .collect();
        assert_eq!(
            reasons["settings/appearance.json"],
            SkipReason::DuplicateName
        );
        assert_eq!(reasons["settings/editor.json"], SkipReason::NotAnObject);
        assert_eq!(reasons["settings/layout.json"], SkipReason::NotJson);
        assert_eq!(reasons["settings/print.json"], SkipReason::NotAFile);
        assert_eq!(reasons["settings/markdown.json"], SkipReason::TooLarge);
        assert_eq!(reasons["settings/privacy.json"], SkipReason::UnknownName);
        assert_eq!(reasons["settings/notes.txt"], SkipReason::UnknownName);
    }

    #[test]
    fn stops_reading_at_the_limit_and_reports_the_rest() {
        let (_tmp, repo) = repo_with(|repo, tree| {
            for name in ["a.json", "b.json", "c.json"] {
                tree.insert(name, blob(repo, "{}"), 0o100644).unwrap();
            }
        });
        let tree = head_tree(&repo).unwrap();
        let folder = read_folder(&repo, tree.as_ref(), SETTINGS_DIR, |_| true, 2);
        assert_eq!(folder.files.len(), 2);
        assert_eq!(folder.skipped[0].reason, SkipReason::TooMany);
    }

    #[test]
    fn a_file_where_the_folder_belongs_is_reported() {
        let tmp = TempDir::new().unwrap();
        let repo = Repository::init(tmp.path()).unwrap();
        let mut root = repo.treebuilder(None).unwrap();
        root.insert(SETTINGS_DIR, blob(&repo, "{}"), 0o100644)
            .unwrap();
        let tree = repo.find_tree(root.write().unwrap()).unwrap();
        let folder = read_folder(&repo, Some(&tree), SETTINGS_DIR, |_| true, 10);
        assert!(folder.files.is_empty());
        assert_eq!(folder.skipped[0].reason, SkipReason::NotAFolder);
    }

    #[test]
    fn a_head_that_cannot_be_read_is_an_error() {
        let tmp = TempDir::new().unwrap();
        Repository::init(tmp.path()).unwrap();
        fs::write(
            tmp.path().join(".git/HEAD"),
            "not a ref
",
        )
        .unwrap();
        let repo = Repository::open(tmp.path()).unwrap();
        assert!(head_tree(&repo).is_err());
    }

    #[test]
    fn an_unborn_repo_and_a_missing_folder_read_as_empty() {
        let tmp = TempDir::new().unwrap();
        let repo = Repository::init(tmp.path()).unwrap();
        assert!(head_tree(&repo).unwrap().is_none());
        let folder = read_folder(&repo, None, SETTINGS_DIR, |_| true, 10);
        assert!(folder.files.is_empty() && folder.skipped.is_empty());
    }

    #[test]
    fn writes_sorted_json_and_rewrites_it_byte_for_byte() {
        let tmp = TempDir::new().unwrap();
        let value = object(json!({"b": 1, "a": {"d": [{"z": 1, "y": 2}], "c": true}}));
        write_object(tmp.path(), SETTINGS_DIR, "x", &value).unwrap();
        let path = tmp.path().join("settings/x.json");
        let first = fs::read(&path).unwrap();
        let text = String::from_utf8(first.clone()).unwrap();
        assert!(text.ends_with("}\n"));
        assert!(text.find("\"a\"").unwrap() < text.find("\"b\"").unwrap());
        assert!(text.find("\"y\"").unwrap() < text.find("\"z\"").unwrap());
        write_object(tmp.path(), SETTINGS_DIR, "x", &value).unwrap();
        assert_eq!(fs::read(&path).unwrap(), first);
    }

    #[test]
    fn removes_a_file_and_takes_a_missing_one_in_stride() {
        let tmp = TempDir::new().unwrap();
        remove_object(tmp.path(), PLUGINS_DIR, "gone").unwrap();
        write_object(tmp.path(), PLUGINS_DIR, "a.b", &Object::new()).unwrap();
        remove_object(tmp.path(), PLUGINS_DIR, "a.b").unwrap();
        assert!(!tmp.path().join("plugins/a.b.json").exists());
        remove_object(tmp.path(), PLUGINS_DIR, "a.b").unwrap();
    }

    #[test]
    fn a_file_or_folder_a_remote_left_in_the_way_gives_way() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(SETTINGS_DIR), "a file").unwrap();
        remove_object(tmp.path(), SETTINGS_DIR, "x").unwrap();
        write_object(tmp.path(), SETTINGS_DIR, "x", &Object::new()).unwrap();
        assert!(tmp.path().join("settings/x.json").is_file());

        fs::create_dir_all(tmp.path().join("plugins/a.b.json/inner")).unwrap();
        write_object(tmp.path(), PLUGINS_DIR, "a.b", &Object::new()).unwrap();
        assert!(tmp.path().join("plugins/a.b.json").is_file());
        fs::remove_file(tmp.path().join("plugins/a.b.json")).unwrap();
        fs::create_dir_all(tmp.path().join("plugins/a.b.json")).unwrap();
        remove_object(tmp.path(), PLUGINS_DIR, "a.b").unwrap();
        assert!(!tmp.path().join("plugins/a.b.json").exists());
    }

    #[test]
    fn a_clone_that_is_a_file_takes_no_writes() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("repo");
        fs::write(&file, "").unwrap();
        assert!(write_object(&file, SETTINGS_DIR, "x", &Object::new()).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "");
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_is_never_written_through() {
        let tmp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), tmp.path().join(SETTINGS_DIR)).unwrap();
        assert!(write_object(tmp.path(), SETTINGS_DIR, "x", &Object::new()).is_err());
        assert!(!outside.path().join("x.json").exists());

        fs::create_dir(tmp.path().join(PLUGINS_DIR)).unwrap();
        let target = outside.path().join("victim");
        fs::write(&target, "keep").unwrap();
        std::os::unix::fs::symlink(&target, tmp.path().join("plugins/a.json")).unwrap();
        assert!(write_object(tmp.path(), PLUGINS_DIR, "a", &Object::new()).is_err());
        assert!(remove_object(tmp.path(), PLUGINS_DIR, "a").is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "keep");
    }
}
