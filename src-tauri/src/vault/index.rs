//! The [`Vault`] itself: building the note set from a workspace root and
//! keeping it current as files change.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use super::canvas::{self, Canvas};
use super::graph::{self, Graph};
use super::note::{self, Note};
use super::resolve::{compare_paths, Resolver};
use crate::commands::walk::{
    scan_files, ScanStatus, SCAN_MAX_FILE_BYTES, WALK_MAX_DEPTH, WALK_MAX_FILES, WALK_SKIP_DIRS,
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
    canonical_root: Option<PathBuf>,
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
        let mut notes = Vec::new();
        let mut canvases = HashMap::new();
        let status = scan_files(root, is_indexable, max_files, max_depth, |path, content| {
            let path = path.to_string_lossy().to_string();
            notes.push(index_file(&path, content, &mut canvases));
        })?;

        let mut vault = Vault {
            canonical_root: std::fs::canonicalize(root).ok(),
            root: root.to_path_buf(),
            notes,
            canvases,
            resolver: Resolver::default(),
            graph: Graph::default(),
            field_names: BTreeSet::new(),
            walk_status: status,
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
            let Some(path) = self.inside_root(path) else {
                continue;
            };
            let existing = self.id_of(&path.to_string_lossy());
            let key = match existing {
                Some(index) => self.notes[index].path.clone(),
                None => path.to_string_lossy().to_string(),
            };

            let content = self.walkable(&path).then(|| std::fs::read_to_string(&path));
            let Some(Ok(content)) = content else {
                // A path the walker would have skipped, a deletion, or a file
                // that went away mid-update: none of them belong in the index.
                if let Some(index) = existing {
                    self.notes.remove(index);
                    self.canvases.remove(&key);
                    touched = true;
                }
                continue;
            };

            let note = index_file(&key, &content, &mut self.canvases);
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

    /// `path` respelled the way the index spells it, or `None` when it lies
    /// outside the root. Watcher events arrive against the canonical root, and
    /// two spellings of one file must not index twice.
    fn inside_root(&self, path: &Path) -> Option<PathBuf> {
        let relative = path
            .strip_prefix(&self.root)
            .ok()
            .or_else(|| path.strip_prefix(self.canonical_root.as_ref()?).ok())?;
        Some(self.root.join(relative).components().collect())
    }

    /// Whether the walk would have visited `path`. `apply_changes` reads files
    /// the walk never offered it, so the same gates have to hold here: no
    /// hidden or noisy directories, no symlinks out of the workspace, and no
    /// file past the size cap.
    fn walkable(&self, path: &Path) -> bool {
        if !is_indexable(path) {
            return false;
        }
        let Ok(relative) = path.strip_prefix(&self.root) else {
            return false;
        };
        if relative.components().count() > self.max_depth {
            return false;
        }
        for component in relative.components() {
            let name = component.as_os_str().to_string_lossy();
            if name.starts_with('.') || WALK_SKIP_DIRS.contains(&name.as_ref()) {
                return false;
            }
        }
        // `symlink_metadata` reports the link itself, so `is_file` already
        // refuses a symlinked note the way the walk does.
        let Ok(meta) = std::fs::symlink_metadata(path) else {
            return false;
        };
        if !meta.is_file() || meta.len() > SCAN_MAX_FILE_BYTES {
            return false;
        }
        // A symlink further up the path is invisible to that check, and the
        // watcher follows links, so a linked directory would otherwise deliver
        // events for files outside the workspace entirely.
        let Some(root) = &self.canonical_root else {
            return false;
        };
        std::fs::canonicalize(path).is_ok_and(|resolved| resolved.starts_with(root))
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
    pub(super) fn status(&self) -> ScanStatus {
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

fn index_file(path: &str, content: &str, canvases: &mut HashMap<String, Canvas>) -> Note {
    if crate::is_canvas_file(Path::new(path)) {
        let (note, canvas) = canvas::extract_canvas(path, content);
        canvases.insert(path.to_string(), canvas);
        return note;
    }
    canvases.remove(path);
    note::extract_note(path, content)
}
