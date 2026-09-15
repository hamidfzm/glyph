//! Moving a note or folder without breaking what points at it. Every link is
//! resolved twice, against the workspace before the move and after it, and
//! only a link whose answer would change is rewritten, so a same-named note
//! elsewhere or a mention in code is never touched.

use std::ffi::OsStr;
use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::canvas::file_values;
use super::frontmatter::split_frontmatter;
use super::index::strip_bom;
use super::note::{scan, Note};
use super::resolve::{compare_paths, stem_of, Resolver};
use super::store::{apply_changes, with_synced_vault, VaultStore};
use super::Vault;
use crate::grants::GrantRegistry;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relink {
    pub new_path: String,
    /// Files whose links change, each spelled where it lives when the call
    /// returns: before the move for a dry run, after it otherwise.
    pub files: Vec<RelinkedFile>,
    /// The write that stopped the rewrite; the files listed stay written.
    pub failed: Option<RelinkFailure>,
}

impl Relink {
    pub fn unmoved(path: String) -> Self {
        Relink {
            new_path: path,
            files: Vec::new(),
            failed: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkedFile {
    pub path: String,
    pub links: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkFailure {
    pub path: String,
    pub error: String,
}

struct Rewrite {
    path: String,
    moved_to: String,
    content: String,
    links: usize,
    /// The file as the plan read it.
    original: String,
}

/// Move `from` to `to` and rewrite every link the move would break; a rename
/// is a move within one folder. A dry run reads and reports, and writes nothing.
pub fn relocate(
    root: &str,
    from: &Path,
    to: &Path,
    dry_run: bool,
    grants: &GrantRegistry,
    store: &VaultStore,
) -> Result<Relink, String> {
    let (files, failed) = with_synced_vault(root, grants, store, |vault| {
        let rewrites = plan(vault, from, to)?;
        if dry_run {
            let files = rewrites
                .into_iter()
                .map(|rewrite| RelinkedFile {
                    path: rewrite.path,
                    links: rewrite.links,
                })
                .collect();
            return Ok((files, None));
        }

        // Renamed first: the destination is only final once it exists, and a
        // rename that fails leaves every file untouched.
        fs::rename(from, to).map_err(|e| format!("Failed to move: {e}"))?;
        Ok(write_rewrites(grants, rewrites))
    })?;

    if !dry_run {
        let mut changed = vec![from.to_path_buf(), to.to_path_buf()];
        changed.extend(files.iter().map(|file| PathBuf::from(&file.path)));
        apply_changes(store, root, &changed);
    }
    Ok(Relink {
        new_path: to.to_string_lossy().to_string(),
        files,
        failed,
    })
}

fn plan(vault: &Vault, from: &Path, to: &Path) -> Result<Vec<Rewrite>, String> {
    let (Some((from, _)), Some((to, _))) = (vault.inside_root(from), vault.inside_root(to)) else {
        return Err("Refusing to move outside the workspace".to_string());
    };
    let relinker = Relinker::new(vault, Move { from, to });
    let mut rewrites = Vec::new();
    for note in &vault.notes {
        if !relinker.affects(note) {
            continue;
        }
        let raw = fs::read_to_string(&note.path)
            .map_err(|e| format!("Failed to read {}: {e}", note.path))?;
        let body = strip_bom(&raw);
        let edits = relinker.edits(&note.path, body);
        if edits.is_empty() {
            continue;
        }
        rewrites.push(Rewrite {
            path: note.path.clone(),
            moved_to: relinker.moved.apply(&note.path),
            links: edits.len(),
            content: format!("{}{}", &raw[..raw.len() - body.len()], splice(body, edits)),
            original: raw,
        });
    }
    Ok(rewrites)
}

/// Writes the rewrites in order and stops at the first that fails, so the files
/// already written stay written and the failure names the one that was not.
fn write_rewrites(
    grants: &GrantRegistry,
    rewrites: Vec<Rewrite>,
) -> (Vec<RelinkedFile>, Option<RelinkFailure>) {
    let mut files = Vec::new();
    for rewrite in rewrites {
        if let Err(error) = write_rewrite(grants, &rewrite) {
            let failure = RelinkFailure {
                path: rewrite.moved_to,
                error,
            };
            return (files, Some(failure));
        }
        files.push(RelinkedFile {
            path: rewrite.moved_to,
            links: rewrite.links,
        });
    }
    (files, None)
}

/// A file that changed since it was planned keeps its new content: the planned
/// text would put back what an editor or a sync pull just replaced.
fn write_rewrite(grants: &GrantRegistry, rewrite: &Rewrite) -> Result<(), String> {
    let path = grants.ensure_writable(&rewrite.moved_to)?;
    let current = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if current != rewrite.original {
        return Err("changed on disk while its links were being updated".to_string());
    }
    fs::write(&path, &rewrite.content).map_err(|e| e.to_string())
}

struct Move {
    from: PathBuf,
    to: PathBuf,
}

impl Move {
    /// `path` once the move is done, spelled the way the index spells it.
    fn apply(&self, path: &str) -> String {
        let mut rest = Path::new(path).components();
        let inside = self.from.components().all(|part| {
            rest.next()
                .is_some_and(|own| same_name(own.as_os_str(), part.as_os_str()))
        });
        if !inside {
            return path.to_string();
        }
        let rest = rest.as_path();
        if rest.as_os_str().is_empty() {
            return self.to.to_string_lossy().to_string();
        }
        self.to.join(rest).to_string_lossy().to_string()
    }
}

/// Windows and macOS ignore case in file names by default, so a link can spell a
/// folder or note differently from the disk and still reach it.
fn same_name(a: &OsStr, b: &OsStr) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

struct Relinker<'a> {
    vault: &'a Vault,
    moved: Move,
    /// The resolver the index builds once the move is done.
    after: Resolver,
}

impl<'a> Relinker<'a> {
    fn new(vault: &'a Vault, moved: Move) -> Self {
        let mut entries: Vec<(String, Vec<String>)> = vault
            .notes
            .iter()
            .map(|note| (moved.apply(&note.path), note.aliases.clone()))
            .collect();
        // Path order decides a same-directory tie, so it has to match the index's.
        entries.sort_by(|a, b| compare_paths(&a.0, &b.0));
        let (paths, aliases): (Vec<String>, Vec<Vec<String>>) = entries.into_iter().unzip();
        Relinker {
            vault,
            moved,
            after: Resolver::build(&paths, &aliases),
        }
    }

    fn is_canvas(&self, path: &str) -> bool {
        self.vault.canvases.contains_key(path)
    }

    fn affects(&self, note: &Note) -> bool {
        // A canvas card's `file` is relative to its board, as the renderer reads it.
        let links = note.links.iter().any(|link| {
            if self.is_canvas(&note.path) {
                self.destination(&note.path, &link.target).is_some()
            } else {
                self.wikilink(&note.path, &link.target).is_some()
            }
        });
        links
            || note
                .file_links
                .iter()
                .any(|dest| self.destination(&note.path, dest).is_some())
    }

    fn edits(&self, source: &str, content: &str) -> Vec<(Range<usize>, String)> {
        if self.is_canvas(source) {
            return file_values(content)
                .into_iter()
                .filter_map(|(file, span)| {
                    let quoted = serde_json::to_string(&self.destination(source, &file)?).ok()?;
                    Some((span, quoted[1..quoted.len() - 1].to_string()))
                })
                .collect();
        }

        let (_, body_start) = split_frontmatter(content);
        let found = scan(content, body_start);
        let mut edits: Vec<(Range<usize>, String)> = found
            .links
            .into_iter()
            .filter_map(|(link, span)| Some((span, self.wikilink(source, &link.target)?)))
            .collect();
        for (dest, span) in found.file_links {
            let Some(mut new_dest) = self.destination(source, &dest) else {
                continue;
            };
            // A bare destination ends at whitespace, so a path that gained a
            // space needs the brackets to stay one link.
            if !content[..span.start].ends_with('<') && new_dest.contains(char::is_whitespace) {
                new_dest = format!("<{new_dest}>");
            }
            edits.push((span, new_dest));
        }
        edits
    }

    fn resolves_after(&self, target: &str, from: &str) -> Option<&str> {
        self.after
            .resolve(target, Some(from))
            .map(|id| self.after.path(id))
    }

    /// The new target of a wikilink in `source`, when the move changes what it
    /// resolves to. A link that resolved nowhere stays as written.
    fn wikilink(&self, source: &str, target: &str) -> Option<String> {
        let before = &self.vault.resolver;
        let expected = self
            .moved
            .apply(before.path(before.resolve(target, Some(source))?));
        let source_after = self.moved.apply(source);
        if self.resolves_after(target, &source_after) == Some(expected.as_str()) {
            return None;
        }
        shortest_target(
            target,
            &expected,
            &source_after,
            &self.vault.root,
            &self.after,
        )
    }

    /// The new destination of a link relative to `source` (a markdown link, or a
    /// canvas card's `file`), when the link or what it points at moves. A link
    /// that was already broken stays.
    fn destination(&self, source: &str, dest: &str) -> Option<String> {
        let root = &self.vault.root;
        let (path, fragment) = dest.split_at(dest.find('#').unwrap_or(dest.len()));
        let target = resolve_relative(root, source, path)?;
        let expected = self.moved.apply(&target.to_string_lossy());
        let source_after = self.moved.apply(source);
        let now = resolve_relative(root, &source_after, path);
        if now.is_some_and(|now| now.to_string_lossy() == expected) {
            return None;
        }
        // Probed only for a link the move affects, and only inside the workspace.
        if !target.exists() {
            return None;
        }
        let relative = relative_path(root, &source_after, &expected)?;
        // The renderer ends a destination at `#`, so such a name cannot be linked.
        if relative.contains('#') {
            return None;
        }
        let dot = if dest.starts_with("./") && !relative.starts_with("../") {
            "./"
        } else {
            ""
        };
        Some(format!("{dot}{relative}{fragment}"))
    }
}

fn segments(root: &Path, path: &Path) -> Option<Vec<String>> {
    let relative = path.strip_prefix(root).ok()?;
    Some(
        relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy().to_string())
            .collect(),
    )
}

/// `path` resolved against the folder of `from` as `normalizeRelativePath`
/// resolves it, or `None` once `..` climbs out of the workspace.
fn resolve_relative(root: &Path, from: &str, path: &str) -> Option<PathBuf> {
    let mut parts = segments(root, Path::new(from).parent()?)?;
    for segment in path.split(['/', '\\']) {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            name => parts.push(name.to_string()),
        }
    }
    let resolved = parts
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part));
    // A segment such as `C:` replaces the whole path on Windows when joined.
    resolved.starts_with(root).then_some(resolved)
}

/// The forward-slashed path from the folder of `from` to `to`.
fn relative_path(root: &Path, from: &str, to: &str) -> Option<String> {
    let dir = segments(root, Path::new(from).parent()?)?;
    let target = segments(root, Path::new(to))?;
    let common = dir.iter().zip(&target).take_while(|(a, b)| a == b).count();
    let mut parts = vec!["..".to_string(); dir.len() - common];
    parts.extend_from_slice(&target[common..]);
    Some(parts.join("/"))
}

/// The shortest target that resolves to `to` from `from`: the name, then more
/// of the path, never fewer segments than the link was written with. A `.md`
/// the user typed stays.
fn shortest_target(
    written: &str,
    to: &str,
    from: &str,
    root: &Path,
    resolver: &Resolver,
) -> Option<String> {
    let mut parts = segments(root, Path::new(to))?;
    let name = parts.last_mut()?;
    let typed_md = written.to_ascii_lowercase().ends_with(".md");
    if !(typed_md && name.to_ascii_lowercase().ends_with(".md")) {
        *name = stem_of(name).to_string();
    }
    let written_depth = written.split(['/', '\\']).filter(|s| !s.is_empty()).count();
    // A note at the root shadowed by a same-named one beside the link has no
    // target that reaches it; that link is left as written rather than pointed
    // at the wrong note.
    (written_depth.clamp(1, parts.len())..=parts.len())
        .map(|depth| parts[parts.len() - depth..].join("/"))
        // Inside `[[...]]` these end the target, so such a name cannot be linked.
        .filter(|candidate| !candidate.contains(['#', '|', '[', ']']))
        .find(|candidate| {
            let reached = resolver.resolve(candidate, Some(from));
            reached.map(|id| resolver.path(id)) == Some(to)
        })
}

/// `content` with each range replaced. A range overlapping an earlier one is
/// dropped rather than corrupting both.
fn splice(content: &str, mut edits: Vec<(Range<usize>, String)>) -> String {
    edits.sort_by_key(|(span, _)| span.start);
    let mut out = String::with_capacity(content.len());
    let mut at = 0;
    for (span, text) in edits {
        if span.start < at {
            continue;
        }
        out.push_str(&content[at..span.start]);
        out.push_str(&text);
        at = span.end;
    }
    out.push_str(&content[at..]);
    out
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::vault::test_support::{relative, unique_tmp};

    /// A workspace holding `files`, named by forward-slashed relative paths.
    fn workspace(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let root = unique_tmp(name);
        for (path, content) in files {
            let path = root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        root
    }

    /// What moving `from` to `to` would write, by relative path.
    fn planned(root: &Path, from: &str, to: &str) -> BTreeMap<String, String> {
        let vault = Vault::build(root).unwrap();
        let rewrites = plan(&vault, &root.join(from), &root.join(to)).unwrap();
        fs::remove_dir_all(root).unwrap();
        rewrites
            .into_iter()
            .map(|rewrite| (relative(root, &rewrite.path), rewrite.content))
            .collect()
    }

    fn one(path: &str, content: &str) -> BTreeMap<String, String> {
        BTreeMap::from([(path.to_string(), content.to_string())])
    }

    #[test]
    fn a_rename_rewrites_every_wikilink_form_and_keeps_the_rest() {
        let root = workspace(
            "forms",
            &[
                ("Notes/Travel.md", "# Travel"),
                (
                    "Index.md",
                    "[[Travel]] [[Travel|shown]] [[Travel#Day 1]] ![[Travel]]\n[[ travel ]] [[Travel.md]] [[Notes/Travel]] [[Nowhere]]\n",
                ),
            ],
        );
        assert_eq!(
            planned(&root, "Notes/Travel.md", "Notes/Trip.md"),
            one(
                "Index.md",
                "[[Trip]] [[Trip|shown]] [[Trip#Day 1]] ![[Trip]]\n[[ Trip ]] [[Trip.md]] [[Notes/Trip]] [[Nowhere]]\n"
            )
        );
    }

    #[test]
    fn a_same_named_note_elsewhere_keeps_its_links() {
        let root = workspace(
            "same_stem",
            &[
                ("Notes/Travel.md", ""),
                ("Notes/Day.md", "[[Travel]]"),
                ("Archive/Travel.md", "[[Travel]]"),
                ("Archive/Log.md", "[[Travel]]"),
                ("Other/Plan.md", "[[Travel]]"),
            ],
        );
        let rewrites = planned(&root, "Notes/Travel.md", "Notes/Trip.md");
        // Archive's links resolved to Archive's own copy and still do.
        assert_eq!(
            rewrites,
            BTreeMap::from([
                ("Notes/Day.md".to_string(), "[[Trip]]".to_string()),
                ("Other/Plan.md".to_string(), "[[Trip]]".to_string()),
            ])
        );
    }

    #[test]
    fn a_move_that_flips_the_tie_break_pins_the_links_it_would_steal() {
        let root = workspace(
            "tie_break",
            &[
                ("Notes/Travel.md", ""),
                ("Archive/Travel.md", ""),
                ("Archive/Log.md", "[[Travel]]"),
                ("Other/Plan.md", "[[Travel]]"),
            ],
        );
        assert_eq!(
            planned(&root, "Archive/Travel.md", "Other/Travel.md"),
            BTreeMap::from([
                ("Archive/Log.md".to_string(), "[[Other/Travel]]".to_string()),
                ("Other/Plan.md".to_string(), "[[Notes/Travel]]".to_string()),
            ])
        );
    }

    #[test]
    fn code_is_never_rewritten() {
        let root = workspace(
            "code",
            &[
                ("Travel.md", ""),
                (
                    "Index.md",
                    "```\n[[Travel]]\n```\n`[[Travel]]` `[t](Travel.md)` [[Travel]]\n",
                ),
            ],
        );
        assert_eq!(
            planned(&root, "Travel.md", "Trip.md"),
            one(
                "Index.md",
                "```\n[[Travel]]\n```\n`[[Travel]]` `[t](Travel.md)` [[Trip]]\n"
            )
        );
    }

    #[test]
    fn markdown_links_to_a_moved_note_are_recomputed() {
        let root = workspace(
            "markdown",
            &[
                ("Notes/Travel.md", ""),
                (
                    "Index.md",
                    "[t](Notes/Travel.md#Day) [u](<Notes/Travel.md>) [v](./Notes/Travel.md) [gone](Missing.md) [[Travel]]",
                ),
            ],
        );
        assert_eq!(
            planned(&root, "Notes/Travel.md", "My Trips/Travel.md"),
            one(
                "Index.md",
                "[t](<My Trips/Travel.md#Day>) [u](<My Trips/Travel.md>) [v](<./My Trips/Travel.md>) [gone](Missing.md) [[Travel]]"
            )
        );
    }

    #[test]
    fn a_moved_note_keeps_its_own_relative_links() {
        let root = workspace(
            "outgoing",
            &[
                (
                    "Notes/Travel.md",
                    "![map](map.png) [home](../Index.md) [[Index]] [x](nope.md)",
                ),
                ("Notes/map.png", "png"),
                ("Index.md", ""),
            ],
        );
        assert_eq!(
            planned(&root, "Notes/Travel.md", "Archive/Deep/Travel.md"),
            one(
                "Notes/Travel.md",
                "![map](../../Notes/map.png) [home](../../Index.md) [[Index]] [x](nope.md)"
            )
        );
    }

    #[test]
    fn a_folder_rename_rewrites_links_to_everything_inside() {
        let root = workspace(
            "folder",
            &[
                ("Notes/Travel.md", "[c](Cooking.md) [[Cooking]]"),
                ("Notes/Cooking.md", ""),
                ("Notes/pic.png", "png"),
                (
                    "Index.md",
                    "[t](Notes/Travel.md) [[Notes/Cooking]] ![img](Notes/pic.png)",
                ),
            ],
        );
        // Links between notes inside the folder move with it and stay valid.
        assert_eq!(
            planned(&root, "Notes", "Recipes"),
            one(
                "Index.md",
                "[t](Recipes/Travel.md) [[Recipes/Cooking]] ![img](Recipes/pic.png)"
            )
        );
    }

    #[test]
    fn a_canvas_card_is_rewritten_in_place() {
        let board = "{\n\t\"nodes\": [\n\t\t{\"id\":\"a\",\"type\":\"file\",\"file\":\"Notes/Travel.md\",\"subpath\":\"#Day\",\"x\":0,\"y\":0,\"width\":1,\"height\":1},\n\t\t{\"id\":\"b\",\"type\":\"text\",\"text\":\"\\\"file\\\": \\\"Notes/Travel.md\\\"\",\"x\":0,\"y\":0,\"width\":1,\"height\":1},\n\t\t{\"id\":\"c\",\"type\":\"file\",\"file\":\"Notes/pic.png\",\"x\":0,\"y\":0,\"width\":1,\"height\":1}\n\t]\n}\n";
        let root = workspace(
            "canvas",
            &[
                ("Notes/Travel.md", ""),
                ("Notes/pic.png", "png"),
                ("Board.canvas", board),
            ],
        );
        let expected = board
            .replacen(
                "\"file\":\"Notes/Travel.md\"",
                "\"file\":\"Trips/Travel.md\"",
                1,
            )
            .replace("\"file\":\"Notes/pic.png\"", "\"file\":\"Trips/pic.png\"");
        assert_eq!(
            planned(&root, "Notes", "Trips"),
            one("Board.canvas", &expected)
        );
    }

    #[test]
    fn a_bom_and_crlf_line_endings_survive() {
        let root = workspace(
            "bom",
            &[
                ("Travel.md", ""),
                ("Index.md", "\u{feff}# Title\r\n[[Travel]]\r\nend\r\n"),
            ],
        );
        assert_eq!(
            planned(&root, "Travel.md", "Trip.md"),
            one("Index.md", "\u{feff}# Title\r\n[[Trip]]\r\nend\r\n")
        );
    }

    #[test]
    fn a_move_nothing_links_to_plans_nothing() {
        let root = workspace(
            "nothing",
            &[("Travel.md", "[[Nowhere]]"), ("Index.md", "text")],
        );
        assert!(planned(&root, "Travel.md", "Trip.md").is_empty());
    }

    #[test]
    fn a_link_no_target_can_reach_is_left_as_written() {
        let root = workspace(
            "shadowed",
            &[
                ("Notes/Travel.md", ""),
                ("Archive/Travel.md", ""),
                ("Notes/Day.md", "[[Archive/Travel]] and [[Travel]]"),
            ],
        );
        // At the root, `[[Travel]]` from Notes/ would reach Notes/Travel.md.
        assert!(planned(&root, "Archive/Travel.md", "Travel.md").is_empty());
    }

    #[test]
    fn a_file_edited_since_indexing_is_planned_from_disk() {
        let root = workspace("stale", &[("Travel.md", ""), ("Index.md", "[[Travel]]")]);
        let vault = Vault::build(&root).unwrap();
        fs::write(root.join("Index.md"), "no links now").unwrap();
        let rewrites = plan(&vault, &root.join("Travel.md"), &root.join("Trip.md")).unwrap();
        fs::remove_dir_all(&root).unwrap();
        assert!(rewrites.is_empty());
    }

    #[test]
    fn a_card_on_an_attachment_that_stays_put_is_untouched() {
        let board = r#"{"nodes":[{"id":"a","type":"file","file":"Other/pic.png","x":0,"y":0,"width":1,"height":1}]}"#;
        let root = workspace(
            "canvas_unmoved",
            &[
                ("Notes/Travel.md", ""),
                ("Other/pic.png", "png"),
                ("Board.canvas", board),
            ],
        );
        assert!(planned(&root, "Notes", "Trips").is_empty());
    }

    #[test]
    fn overlapping_edits_keep_the_first() {
        let edits = vec![(1..4, "X".to_string()), (2..3, "Y".to_string())];
        assert_eq!(splice("abcdef", edits), "aXef");
    }

    /// A board holding one file card per value.
    fn board(files: &[&str]) -> String {
        let cards: Vec<String> = files
            .iter()
            .enumerate()
            .map(|(i, file)| {
                format!(r#"{{"id":"{i}","type":"file","file":"{file}","x":0,"y":0,"width":1,"height":1}}"#)
            })
            .collect();
        format!(r#"{{"nodes":[{}]}}"#, cards.join(","))
    }

    #[test]
    fn a_card_is_relative_to_its_board_like_a_markdown_link() {
        // A board at the root whose card names the note bare.
        let root = workspace(
            "card_root",
            &[("Travel.md", ""), ("Board.canvas", &board(&["Travel.md"]))],
        );
        assert_eq!(
            planned(&root, "Travel.md", "Trips/Travel.md"),
            one("Board.canvas", &board(&["Trips/Travel.md"]))
        );

        // A board in a subfolder, beside its note.
        let root = workspace(
            "card_sub",
            &[
                ("Boards/Travel.md", ""),
                ("Boards/Board.canvas", &board(&["Travel.md"])),
            ],
        );
        assert_eq!(
            planned(&root, "Boards/Travel.md", "Boards/Trip.md"),
            one("Boards/Board.canvas", &board(&["Trip.md"]))
        );

        // The board itself moving away from its cards.
        let root = workspace(
            "card_board",
            &[
                ("Notes/Travel.md", ""),
                ("Board.canvas", &board(&["Notes/Travel.md"])),
            ],
        );
        assert_eq!(
            planned(&root, "Board.canvas", "Boards/Board.canvas"),
            one("Board.canvas", &board(&["../Notes/Travel.md"]))
        );
    }

    #[test]
    fn a_card_naming_a_path_outside_the_workspace_is_never_followed() {
        let hostile = [
            "//attacker.example/share/x.md",
            "C:/Windows/x.md",
            "/etc/hosts",
            "Notes/../../x.md",
            "https://example.com/x.md",
        ];
        let root = workspace(
            "card_outside",
            &[("Notes/Travel.md", ""), ("Board.canvas", &board(&hostile))],
        );
        let board_path = root.join("Board.canvas").to_string_lossy().to_string();
        for file in hostile {
            let resolved = resolve_relative(&root, &board_path, file);
            assert!(
                resolved.is_none_or(|path| path.starts_with(&root)),
                "{file} resolved outside the workspace"
            );
        }
        assert!(planned(&root, "Notes", "Trips").is_empty());
    }

    #[test]
    fn a_name_no_link_can_spell_leaves_the_links_alone() {
        let root = workspace(
            "hash_name",
            &[("Travel.md", ""), ("Index.md", "[[Travel]] [t](Travel.md)")],
        );
        assert!(planned(&root, "Travel.md", "C# notes.md").is_empty());
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn a_link_spelled_in_another_case_follows_the_move() {
        let root = workspace(
            "case",
            &[
                ("Notes/Travel.md", ""),
                ("Index.md", "[t](notes/travel.md)"),
            ],
        );
        assert_eq!(
            planned(&root, "Notes", "Trips"),
            one("Index.md", "[t](Trips/travel.md)")
        );
    }

    #[test]
    fn a_file_changed_after_planning_keeps_its_new_content() {
        let root = workspace(
            "changed",
            &[
                ("Travel.md", ""),
                ("A.md", "[[Travel]]"),
                ("B.md", "[[Travel]]"),
            ],
        );
        let vault = Vault::build(&root).unwrap();
        let rewrites = plan(&vault, &root.join("Travel.md"), &root.join("Trip.md")).unwrap();
        fs::write(root.join("B.md"), "[[Travel]] edited meanwhile").unwrap();
        let grants = GrantRegistry::default();
        grants.grant_workspace(&root).unwrap();

        let (files, failed) = write_rewrites(&grants, rewrites);

        let a = fs::read_to_string(root.join("A.md")).unwrap();
        let b = fs::read_to_string(root.join("B.md")).unwrap();
        fs::remove_dir_all(&root).unwrap();
        let written: Vec<String> = files.iter().map(|f| relative(&root, &f.path)).collect();
        assert_eq!(written, ["A.md"]);
        assert_eq!(relative(&root, &failed.expect("B.md changed").path), "B.md");
        assert_eq!(a, "[[Trip]]");
        assert_eq!(b, "[[Travel]] edited meanwhile");
    }

    #[test]
    fn a_destination_outside_the_workspace_is_refused() {
        let root = workspace("outside", &[("Travel.md", "")]);
        let vault = Vault::build(&root).unwrap();
        let outside = unique_tmp("outside_target");
        assert!(plan(&vault, &root.join("Travel.md"), &outside.join("Travel.md")).is_err());
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }
}
