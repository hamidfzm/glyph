pub(super) const WALK_MAX_DEPTH: usize = 32;
pub(super) const WALK_MAX_FILES: usize = 10_000;
pub(super) const WALK_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".svn", ".hg"];
