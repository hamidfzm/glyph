//! Resolves a `[[wikilink]]` target to an indexed note. Match is
//! case-insensitive on the filename stem, with `.md` stripped; a target
//! carrying a separator matches a path suffix instead. When several files
//! share a stem, the one in the linking file's directory wins.

use std::collections::HashMap;

/// A leading dot is part of the name, so `.hidden` keeps it.
pub(crate) fn stem_of(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.rfind('.') {
        Some(dot) if dot > 0 => &name[..dot],
        _ => name,
    }
}

pub(crate) fn dir_of(path: &str) -> &str {
    match path.rfind(['/', '\\']) {
        Some(idx) => &path[..idx],
        None => "",
    }
}

/// Deterministic path ordering that does not depend on the host's locale.
pub(crate) fn compare_paths(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| a.cmp(b))
}

/// Split a raw target on its first `#`. An empty heading is no heading.
pub(crate) fn split_heading(raw: &str) -> (&str, Option<&str>) {
    match raw.split_once('#') {
        Some((target, heading)) => {
            let heading = heading.trim();
            (target, (!heading.is_empty()).then_some(heading))
        }
        None => (raw, None),
    }
}

fn normalize_target(raw: &str) -> &str {
    let trimmed = raw.trim();
    let Some(cut) = trimmed.len().checked_sub(3) else {
        return trimmed;
    };
    if trimmed.is_char_boundary(cut) && trimmed[cut..].eq_ignore_ascii_case(".md") {
        return &trimmed[..cut];
    }
    trimmed
}

/// Strip a trailing extension, but only one that is not itself a path segment.
fn without_extension(path: &str) -> &str {
    let name_start = path.rfind(['/', '\\']).map_or(0, |idx| idx + 1);
    match path[name_start..].rfind('.') {
        Some(dot) if dot > 0 => &path[..name_start + dot],
        _ => path,
    }
}

#[derive(Debug, Default)]
pub(crate) struct Resolver {
    /// Every indexed path, in walker order; the index into this vector is a
    /// note's id everywhere else in the module.
    paths: Vec<String>,
    /// Lowercased, forward-slashed, extension-less paths, for suffix matching.
    suffix_keys: Vec<String>,
    by_stem: HashMap<String, Vec<usize>>,
    by_alias: HashMap<String, Vec<usize>>,
}

impl Resolver {
    pub(crate) fn build(paths: &[String], aliases: &[Vec<String>]) -> Self {
        let mut resolver = Resolver {
            paths: paths.to_vec(),
            suffix_keys: paths
                .iter()
                .map(|path| without_extension(path).replace('\\', "/").to_lowercase())
                .collect(),
            ..Resolver::default()
        };
        for (id, path) in paths.iter().enumerate() {
            resolver
                .by_stem
                .entry(stem_of(path).to_lowercase())
                .or_default()
                .push(id);
        }
        for (id, note_aliases) in aliases.iter().enumerate() {
            for alias in note_aliases {
                let key = alias.trim().to_lowercase();
                if key.is_empty() {
                    continue;
                }
                resolver.by_alias.entry(key).or_default().push(id);
            }
        }
        resolver
    }

    pub(crate) fn path(&self, id: usize) -> &str {
        &self.paths[id]
    }

    /// The note `raw_target` names, resolved as if linked from `from`.
    pub(crate) fn resolve(&self, raw_target: &str, from: Option<&str>) -> Option<usize> {
        let (target, _) = split_heading(raw_target);
        let cleaned = normalize_target(target);
        if cleaned.is_empty() || self.paths.is_empty() {
            return None;
        }
        let lower = cleaned.to_lowercase();

        let candidates = if lower.contains('/') || lower.contains('\\') {
            let suffix = format!("/{}", lower.replace('\\', "/"));
            self.suffix_keys
                .iter()
                .enumerate()
                .filter(|(_, key)| key.ends_with(&suffix))
                .map(|(id, _)| id)
                .collect()
        } else {
            // A bare name matches a filename, never a directory.
            self.by_stem.get(&lower).cloned().unwrap_or_default()
        };

        // Aliases are the last resort, so a file actually named `target` still
        // wins over another file that merely lists it under `aliases:`.
        let candidates = if candidates.is_empty() {
            self.by_alias.get(&lower).cloned().unwrap_or_default()
        } else {
            candidates
        };

        self.pick(candidates, from)
    }

    fn pick(&self, mut candidates: Vec<usize>, from: Option<&str>) -> Option<usize> {
        match candidates.len() {
            0 => return None,
            1 => return Some(candidates[0]),
            _ => {}
        }

        if let Some(from) = from {
            let current_dir = dir_of(from);
            if let Some(&same_dir) = candidates
                .iter()
                .find(|&&id| dir_of(&self.paths[id]) == current_dir)
            {
                return Some(same_dir);
            }
        }

        // Stable fallback: shortest path, then by name. Counted in chars
        // and compared case-first, so the answer does not move with the host's
        // locale the way the renderer's `localeCompare` does.
        candidates.sort_by(|&a, &b| {
            let (a, b) = (&self.paths[a], &self.paths[b]);
            a.chars()
                .count()
                .cmp(&b.chars().count())
                .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
                .then_with(|| a.cmp(b))
        });
        Some(candidates[0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files() -> Vec<String> {
        [
            "/workspace/Index.md",
            "/workspace/Notes/Cooking.md",
            "/workspace/Notes/Travel.md",
            "/workspace/Archive/Travel.md",
        ]
        .map(String::from)
        .to_vec()
    }

    fn resolver(paths: &[String]) -> Resolver {
        Resolver::build(paths, &vec![Vec::new(); paths.len()])
    }

    fn resolved(target: &str, from: Option<&str>) -> Option<String> {
        let paths = files();
        let resolver = resolver(&paths);
        resolver
            .resolve(target, from)
            .map(|id| resolver.path(id).to_string())
    }

    #[test]
    fn stems_and_directories() {
        assert_eq!(stem_of("/a/b/Note.md"), "Note");
        assert_eq!(stem_of("Note.markdown"), "Note");
        assert_eq!(stem_of("Note"), "Note");
        assert_eq!(stem_of("/a/.hidden"), ".hidden");
        assert_eq!(dir_of("/a/b/Note.md"), "/a/b");
        assert_eq!(dir_of("C:\\a\\Note.md"), "C:\\a");
        assert_eq!(dir_of("Note.md"), "");
    }

    #[test]
    fn headings_split_off_the_target() {
        assert_eq!(split_heading("note"), ("note", None));
        assert_eq!(split_heading("note#section"), ("note", Some("section")));
        assert_eq!(split_heading("note#  "), ("note", None));
    }

    #[test]
    fn nothing_resolves_in_an_empty_workspace() {
        assert_eq!(resolver(&[]).resolve("Note", None), None);
    }

    #[test]
    fn stems_match_case_insensitively() {
        assert_eq!(
            resolved("cooking", None).as_deref(),
            Some("/workspace/Notes/Cooking.md")
        );
        assert_eq!(
            resolved("INDEX", None).as_deref(),
            Some("/workspace/Index.md")
        );
    }

    #[test]
    fn a_trailing_md_is_stripped() {
        assert_eq!(
            resolved("Cooking.md", None).as_deref(),
            Some("/workspace/Notes/Cooking.md")
        );
        assert_eq!(
            resolved("Cooking.MD", None).as_deref(),
            Some("/workspace/Notes/Cooking.md")
        );
    }

    #[test]
    fn an_unknown_target_resolves_to_nothing() {
        assert_eq!(resolved("Missing", None), None);
        assert_eq!(resolved("   ", None), None);
    }

    #[test]
    fn a_heading_does_not_change_the_target() {
        assert_eq!(
            resolved("Cooking#Recipes", None).as_deref(),
            Some("/workspace/Notes/Cooking.md")
        );
    }

    #[test]
    fn colliding_names_prefer_the_linking_file_directory() {
        assert_eq!(
            resolved("Travel", Some("/workspace/Archive/today.md")).as_deref(),
            Some("/workspace/Archive/Travel.md")
        );
        assert_eq!(
            resolved("Travel", Some("/workspace/Notes/today.md")).as_deref(),
            Some("/workspace/Notes/Travel.md")
        );
    }

    #[test]
    fn without_a_same_directory_candidate_the_shortest_path_wins() {
        assert_eq!(
            resolved("Travel", Some("/workspace/Other/today.md")).as_deref(),
            Some("/workspace/Notes/Travel.md")
        );
        assert_eq!(
            resolved("Travel", None).as_deref(),
            Some("/workspace/Notes/Travel.md")
        );
    }

    #[test]
    fn a_target_with_a_separator_matches_a_path_suffix() {
        assert_eq!(
            resolved("Notes/Travel", None).as_deref(),
            Some("/workspace/Notes/Travel.md")
        );
        assert_eq!(
            resolved("Archive/Travel", None).as_deref(),
            Some("/workspace/Archive/Travel.md")
        );
    }

    #[test]
    fn a_dotfile_keeps_its_whole_name_in_a_nested_target() {
        // The renderer strips a leading dot as if it were an extension, which
        // would make `.hidden` match any path ending in a directory separator.
        let paths = [
            "/w/notes/.hidden".to_string(),
            "/w/notes/Real.md".to_string(),
        ];
        let resolver = resolver(&paths);
        assert_eq!(
            resolver
                .resolve("notes/.hidden", None)
                .map(|id| resolver.path(id)),
            Some("/w/notes/.hidden")
        );
    }

    #[test]
    fn a_forward_slash_target_matches_backslash_paths() {
        let paths = ["C:\\ws\\Index.md", "C:\\ws\\Notes\\Ingredients.md"].map(String::from);
        let resolver = resolver(&paths);
        for target in ["Notes/Ingredients", "Notes\\Ingredients"] {
            assert_eq!(
                resolver.resolve(target, None).map(|id| resolver.path(id)),
                Some("C:\\ws\\Notes\\Ingredients.md")
            );
        }
    }

    #[test]
    fn aliases_resolve_only_when_no_file_is_named_that() {
        let paths = files();
        let mut aliases = vec![Vec::new(); paths.len()];
        // Index.md answers to "Home", and Archive/Travel.md claims the name of
        // a real note, which must not win over that note's own file.
        aliases[0] = vec!["Home".to_string()];
        aliases[3] = vec!["Cooking".to_string()];
        let resolver = Resolver::build(&paths, &aliases);

        assert_eq!(
            resolver.resolve("home", None).map(|id| resolver.path(id)),
            Some("/workspace/Index.md")
        );
        assert_eq!(
            resolver
                .resolve("Cooking", None)
                .map(|id| resolver.path(id)),
            Some("/workspace/Notes/Cooking.md")
        );
    }
}
