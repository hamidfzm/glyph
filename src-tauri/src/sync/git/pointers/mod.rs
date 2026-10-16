//! What a repository's own files point libgit2 at, judged before libgit2
//! opens it.
//!
//! libgit2 resolves the paths a repository names: the target of a `.git`
//! file, a `commondir` or `gitdir` file, alternate object stores, and the
//! paths in its config. On Windows resolving a network path connects to its
//! host, which can hand it the user's credentials, and a downloaded folder
//! names any host it likes. libgit2 has no switch for this, so the same files
//! are read here as text first and each path is judged as spelled, never
//! looked up.

mod config;

use std::fs;
use std::path::{Component, Path, PathBuf, Prefix};

/// Refuses a path that must not be looked up: `GrantRegistry::refuse_remote`.
pub type Judge<'a> = &'a dyn Fn(&Path) -> Result<(), String>;

/// libgit2 stops following a chain of alternates before this, and no working
/// tree nests submodules this deep.
const MAX_DEPTH: usize = 8;

/// Refuse the repository at `folder` when opening it would resolve a path
/// `judge` refuses.
pub fn refuse_remote_pointers(folder: &Path, judge: Judge) -> Result<(), String> {
    let folder = plain(folder);
    repository(&folder, judge).map_err(|reason| not_opened(&folder, &reason))
}

/// [`refuse_remote_pointers`], and the same for its submodules: status,
/// staging and checkout open each one.
pub fn refuse_remote_pointers_with_submodules(folder: &Path, judge: Judge) -> Result<(), String> {
    let folder = plain(folder);
    repository(&folder, judge)
        .and_then(|()| submodules(&folder, 0, judge))
        .map_err(|reason| not_opened(&folder, &reason))
}

fn not_opened(folder: &Path, reason: &str) -> String {
    format!(
        "the Git repository in {} was not opened: {reason}",
        folder.display()
    )
}

/// Behind the `\\?\` prefix Windows takes `..` as a name, where libgit2
/// resolves it, so a relative pointer would be placed somewhere else.
fn plain(folder: &Path) -> PathBuf {
    PathBuf::from(crate::cli::plain_path(&folder.to_string_lossy()))
}

fn repository(folder: &Path, judge: Judge) -> Result<(), String> {
    dot_git(folder, judge)?;
    // Where `.git` is no repository, libgit2 tries the folder itself as a
    // bare one: its `commondir` first, the rest once it finds a `HEAD`.
    pointer_file(folder, "commondir", judge)?;
    if folder.join("HEAD").symlink_metadata().is_ok() {
        git_dir(folder, judge)?;
    }
    Ok(())
}

/// The submodules of the repository at `folder`, and theirs. libgit2 lists
/// them itself, from `.gitmodules`, the index and `HEAD`, which opens none of
/// them. `folder` is safe to open by now: its own pointers were judged.
fn submodules(folder: &Path, depth: usize, judge: Judge) -> Result<(), String> {
    if depth == MAX_DEPTH {
        return Err("its submodules nest too deep".into());
    }
    let Ok(repo) = git2::Repository::open(folder) else {
        return Ok(());
    };
    let Some(workdir) = repo.workdir().map(plain) else {
        return Ok(());
    };
    // Parsed like any config, includes followed.
    config::check(&workdir.join(".gitmodules"), judge)?;
    let listed = repo.submodules().map_err(|e| e.message().to_string())?;
    for submodule in listed {
        let path = submodule.path();
        // libgit2 appends the path to the working tree whatever it is.
        if path.is_absolute() {
            return Err(format!("{} is not a submodule Git writes", path.display()));
        }
        let nested = pointer(&workdir, &path.to_string_lossy(), judge)?;
        repository(&nested, judge)?;
        submodules(&nested, depth + 1, judge)?;
    }
    Ok(())
}

/// `<folder>/.git`: a git dir, or a file naming one.
fn dot_git(folder: &Path, judge: Judge) -> Result<(), String> {
    let dot_git = folder.join(".git");
    let Some(text) = read_text(&dot_git)? else {
        return git_dir(&dot_git, judge);
    };
    match text.trim_end_matches(is_space).strip_prefix("gitdir:") {
        Some(named) => {
            let target = pointer(folder, named.trim_start_matches(is_space), judge)?;
            git_dir(&target, judge)
        }
        // Malformed: libgit2 gives up on it.
        None => Ok(()),
    }
}

/// A git dir's own pointers, its config, and its alternates. Nothing is read
/// from a `dir` that does not exist.
fn git_dir(dir: &Path, judge: Judge) -> Result<(), String> {
    pointer_file(dir, "gitdir", judge)?;
    config_files(dir, judge)?;
    let common = match pointer_file(dir, "commondir", judge)? {
        Some(common) => {
            config_files(&common, judge)?;
            common
        }
        None => dir.to_path_buf(),
    };
    alternates(&common.join("objects"), 0, judge)
}

fn pointer_file(dir: &Path, name: &str, judge: Judge) -> Result<Option<PathBuf>, String> {
    match read_text(&dir.join(name))? {
        Some(text) => pointer(dir, text.trim_end_matches(is_space), judge).map(Some),
        None => Ok(None),
    }
}

/// Judge a path a pointer file names and place it: absolute, or relative to
/// `base`. Only the two shapes Git writes are placed. `C:x` and `\x` resolve
/// against the process's current folder or drive, and behind `\\?\` a `..`
/// is a name: libgit2 would look somewhere this cannot follow it to.
fn pointer(base: &Path, named: &str, judge: Judge) -> Result<PathBuf, String> {
    let path = Path::new(named);
    judge(path)?;
    let placeable = match path.components().next() {
        Some(Component::Prefix(prefix)) => {
            matches!(prefix.kind(), Prefix::Disk(_) | Prefix::UNC(..)) && path.has_root()
        }
        Some(Component::RootDir) => false,
        _ => true,
    };
    if !placeable {
        return Err(format!("{named} is not a path Git writes"));
    }
    let target = base.join(path);
    judge(&target)?;
    Ok(target)
}

/// `<objects>/info/alternates`: an object store per line, each with
/// alternates of its own.
fn alternates(objects: &Path, depth: usize, judge: Judge) -> Result<(), String> {
    let Some(text) = read_text(&objects.join("info").join("alternates"))? else {
        return Ok(());
    };
    if depth == MAX_DEPTH {
        return Err("its alternates lead through too many object stores".into());
    }
    let lines = text
        .split(['\r', '\n'])
        .filter(|line| !line.is_empty() && !line.starts_with('#'));
    for line in lines {
        // libgit2 places any other relative line against the process's
        // current folder.
        if !line.starts_with('.') && !Path::new(line).is_absolute() {
            return Err(format!("{line} is not a path Git writes"));
        }
        alternates(&pointer(objects, line, judge)?, depth + 1, judge)?;
    }
    Ok(())
}

fn config_files(dir: &Path, judge: Judge) -> Result<(), String> {
    ["config", "config.worktree"]
        .iter()
        .try_for_each(|name| config::check(&dir.join(name), judge))
}

/// A file libgit2 would read, `None` when there is none. A link is refused
/// unread: nothing shows where it leads.
fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if crate::grants::is_symlink(path) {
        return Err(format!("{} is a link", path.display()));
    }
    Ok(fs::read(path).ok())
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    let Some(bytes) = read(path)? else {
        return Ok(None);
    };
    match String::from_utf8(bytes) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Err(format!("{} is not text", path.display())),
    }
}

/// What libgit2 trims from a pointer file.
fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\x0b' | '\x0c' | '\r')
}

#[cfg(test)]
mod tests;
