//! The [`Vault`] itself: building the note set from a workspace root and
//! keeping it current as files change.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::canvas::{self, Canvas};
use super::graph::{self, Graph};
use super::note::{self, Note};
use super::resolve::{compare_paths, Resolver};
use crate::commands::walk::{
    collect_files, ScanStatus, Stamp, SCAN_MAX_FILE_BYTES, WALK_MAX_DEPTH, WALK_MAX_FILES,
    WALK_SKIP_DIRS,
};

/// Markdown and canvas files both belong to the index; everything else is an
/// attachment the index only ever points at.
fn is_indexable(path: &Path) -> bool {
    crate::is_markdown_file(path) || crate::is_canvas_file(path)
}

#[derive(Debug)]
pub struct Vault {
    pub(super) root: PathBuf,
    /// The root as the filesystem reports it. Watcher events arrive resolved
    /// (a verbatim `\\?\C:\…` prefix on Windows, symlinks followed on macOS),
    /// so without this an incremental update would match nothing.
    canonical_root: PathBuf,
    /// Sorted by path, so an incremental update inserts in place instead of
    /// replaying the walk.
    pub(super) notes: Vec<Note>,
    pub(super) canvases: HashMap<String, Canvas>,
    pub(super) resolver: Resolver,
    pub(super) graph: Graph,
    /// Every frontmatter field name in the workspace, derived with the graph
    /// so the palette does not recompute it per keystroke.
    pub(super) field_names: BTreeSet<String>,
    pub(super) walk_status: ScanStatus,
    /// Modified time and size of every file the last walk or update saw, so
    /// a sync re-reads only what changed.
    stamps: HashMap<String, Stamp>,
    /// Set when an update was turned away at the file cap.
    refused_at_cap: bool,
    max_files: usize,
    max_depth: usize,
}

impl Vault {
    /// Index every markdown and canvas file under `root`, within the shared
    /// walk caps.
    pub fn build(root: &Path) -> Result<Self, String> {
        Self::build_capped(root, WALK_MAX_FILES, WALK_MAX_DEPTH)
    }

    /// Body of [`Vault::build`] with the caps as parameters, so the truncation
    /// branches are testable without creating `WALK_MAX_FILES` real files.
    pub fn build_capped(root: &Path, max_files: usize, max_depth: usize) -> Result<Self, String> {
        let (files, status) = collect_files(root, is_indexable, max_files, max_depth)?;
        let paths: Vec<PathBuf> = files.iter().map(|(path, _)| path.clone()).collect();
        let stamps = files
            .into_iter()
            .map(|(path, stamp)| (path.to_string_lossy().to_string(), stamp))
            .collect();
        let mut notes = Vec::with_capacity(paths.len());
        let mut canvases = HashMap::new();
        for (note, canvas) in index_files(&paths) {
            if let Some(canvas) = canvas {
                canvases.insert(note.path.clone(), canvas);
            }
            notes.push(note);
        }

        let mut vault = Vault {
            canonical_root: std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()),
            root: root.to_path_buf(),
            notes,
            canvases,
            resolver: Resolver::default(),
            graph: Graph::default(),
            field_names: BTreeSet::new(),
            walk_status: status,
            stamps,
            refused_at_cap: false,
            max_files,
            max_depth,
        };
        vault.notes.sort_by(|a, b| compare_paths(&a.path, &b.path));
        vault.rebuild_derived();
        Ok(vault)
    }

    /// Re-index only the paths that changed. Files that vanished are dropped,
    /// new ones are inserted in place; nothing else is read from disk.
    pub fn apply_changes(&mut self, paths: &[PathBuf]) {
        let mut touched = false;
        for path in paths {
            let Some((path, relative)) = self.inside_root(path) else {
                continue;
            };
            let existing = self.id_of(&path.to_string_lossy());
            let key = match existing {
                Some(index) => self.notes[index].path.clone(),
                None => path.to_string_lossy().to_string(),
            };

            let stamp = self.walkable(&path, &relative);
            // Kept for a file that will not read as UTF-8 too, so a sync does
            // not retry it on every call until it changes.
            if let Some(stamp) = stamp {
                self.stamps.insert(key.clone(), stamp);
            } else {
                self.stamps.remove(&key);
            }
            let content = stamp.and_then(|_| std::fs::read_to_string(&path).ok());
            let Some(content) = content else {
                // A path the walker would have skipped, a deletion, or a file
                // that went away mid-update: none of them belong in the index.
                if let Some(index) = existing {
                    self.notes.remove(index);
                    self.canvases.remove(&key);
                    touched = true;
                }
                continue;
            };

            let (note, canvas) = index_file(&key, &content);
            match canvas {
                Some(canvas) => {
                    self.canvases.insert(key.clone(), canvas);
                }
                None => {
                    self.canvases.remove(&key);
                }
            }
            match existing {
                Some(index) => self.notes[index] = note,
                None => {
                    // Growing past the cap the walk enforces would leave the
                    // index reporting a complete scan it no longer has.
                    if self.notes.len() >= self.max_files {
                        self.refused_at_cap = true;
                        continue;
                    }
                    let at = self
                        .notes
                        .partition_point(|other| compare_paths(&other.path, &key).is_lt());
                    self.notes.insert(at, note);
                }
            }
            touched = true;
        }

        if touched {
            self.rebuild_derived();
        }
    }

    /// Catch up with the disk without a watcher: walk again, and re-read only
    /// the files that appeared, vanished, or carry a new modified time or
    /// size. The fresh walk's status replaces the stored one, cap refusals
    /// included, because it has just looked.
    pub fn sync(&mut self) -> Result<(), String> {
        let (files, status) =
            collect_files(&self.root, is_indexable, self.max_files, self.max_depth)?;
        let walked: HashSet<String> = files
            .iter()
            .map(|(path, _)| path.to_string_lossy().to_string())
            .collect();
        // Removals first, so a file that took a deleted one's place under the
        // cap is not turned away.
        let mut changed: Vec<PathBuf> = self
            .stamps
            .keys()
            .filter(|path| !walked.contains(*path))
            .map(PathBuf::from)
            .collect();
        changed.extend(
            files
                .into_iter()
                .filter(|(path, stamp)| self.stamps.get(&*path.to_string_lossy()) != Some(stamp))
                .map(|(path, _)| path),
        );
        if !changed.is_empty() {
            self.apply_changes(&changed);
        }
        self.walk_status = status;
        self.refused_at_cap = false;
        Ok(())
    }

    /// `path` respelled the way the index spells it, or `None` when it lies
    /// outside the root. Watcher events arrive against the canonical root, and
    /// two spellings of one file must not index twice.
    pub(crate) fn inside_root(&self, path: &Path) -> Option<(PathBuf, PathBuf)> {
        let relative = path
            .strip_prefix(&self.root)
            .or_else(|_| path.strip_prefix(&self.canonical_root))
            .ok()?;
        let relative: PathBuf = relative.components().collect();
        Some((self.root.join(&relative), relative))
    }

    /// The file's stamp when the walk would have visited `path`, `None` when
    /// it would not. `apply_changes` reads files the walk never offered it, so
    /// the same gates have to hold here: no hidden or noisy directories, no
    /// symlinks out of the workspace, and no file past the size cap.
    fn walkable(&self, path: &Path, relative: &Path) -> Option<Stamp> {
        if !is_indexable(path) || relative.components().count() > self.max_depth {
            return None;
        }
        for component in relative.components() {
            let name = component.as_os_str().to_string_lossy();
            if name.starts_with('.') || WALK_SKIP_DIRS.contains(&name.as_ref()) {
                return None;
            }
        }
        // `symlink_metadata` reports the link itself, so `is_file` already
        // refuses a symlinked note the way the walk does.
        let meta = std::fs::symlink_metadata(path).ok()?;
        if !meta.is_file() || meta.len() > SCAN_MAX_FILE_BYTES {
            return None;
        }
        // A symlink further up the path is invisible to that check, and the
        // watcher follows links, so a linked directory would otherwise deliver
        // events for files outside the workspace entirely.
        let inside = std::fs::canonicalize(path)
            .is_ok_and(|resolved| resolved.starts_with(&self.canonical_root));
        inside.then(|| Stamp::of(&meta))
    }

    /// Rebuild the resolver and the derived views from the notes already in
    /// memory. Linear in links, and the only work an incremental update repeats.
    fn rebuild_derived(&mut self) {
        let paths: Vec<String> = self.notes.iter().map(|note| note.path.clone()).collect();
        let aliases: Vec<Vec<String>> = self.notes.iter().map(|n| n.aliases.clone()).collect();
        self.resolver = Resolver::build(&paths, &aliases);
        self.graph = graph::build(&self.notes, &self.resolver);
        self.field_names = self
            .notes
            .iter()
            .flat_map(|note| note.fields.keys().cloned())
            .collect();
    }

    /// What the walk reported, unless a later file was turned away at the cap.
    /// That stays reported until a rebuild, because the index cannot know
    /// whether a subsequent deletion made room for the file it refused; a
    /// `vault_refresh` is what answers that.
    pub(crate) fn status(&self) -> ScanStatus {
        if self.refused_at_cap {
            return ScanStatus::file_limit(self.max_files);
        }
        self.walk_status.clone()
    }

    pub(super) fn id_of(&self, path: &str) -> Option<usize> {
        let wanted = Path::new(path);
        self.notes
            .iter()
            .position(|note| Path::new(&note.path) == wanted)
    }
}

fn index_file(path: &str, content: &str) -> (Note, Option<Canvas>) {
    if crate::is_canvas_file(Path::new(path)) {
        let (note, canvas) = canvas::extract_canvas(path, content);
        return (note, Some(canvas));
    }
    (note::extract_note(path, content), None)
}

/// Read and index `paths` across the available cores. Reading is most of a
/// build, every file being an open, a read and a close, and each file stands
/// alone until resolution. Unreadable and non-UTF-8 files are skipped.
fn index_files(paths: &[PathBuf]) -> Vec<(Note, Option<Canvas>)> {
    let workers = std::thread::available_parallelism()
        .map_or(1, |cores| cores.get())
        .min(paths.len())
        .max(1);
    let chunk = paths.len().div_ceil(workers).max(1);
    std::thread::scope(|scope| {
        let handles: Vec<_> = paths
            .chunks(chunk)
            .map(|chunk| {
                scope.spawn(move || {
                    chunk
                        .iter()
                        .filter_map(|path| read_and_index(path))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        // A worker's panic is re-raised here, as it would have been had the
        // file been indexed on this thread.
        handles
            .into_iter()
            .flat_map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
            })
            .collect()
    })
}

fn read_and_index(path: &Path) -> Option<(Note, Option<Canvas>)> {
    let content = std::fs::read_to_string(path).ok()?;
    Some(index_file(&path.to_string_lossy(), &content))
}
