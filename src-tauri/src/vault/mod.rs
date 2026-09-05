//! The workspace index: one owner for every wikilink, backlink, alias, tag
//! and canvas card under a root.
//!
//! Pure Rust with no `tauri::State` and no `AppHandle`, so a headless process
//! can build and query a [`Vault`] in-process.
//!
//! - [`index`] owns the [`Vault`] itself: the walk, the note set, and keeping
//!   it current as files change.
//! - [`snapshot`] and [`queries`] are what callers read: one payload per
//!   workspace, plus the per-note lookups the payload deliberately omits.
//! - [`note`], [`frontmatter`], [`tags`] and [`canvas`] extract one file;
//!   [`resolve`] and [`graph`] turn the whole set into links and backlinks;
//!   [`query`] parses the palette's filter grammar.
//! - [`commands`] is the thin Tauri wrapper that adds the grant check and the
//!   managed store.

pub mod commands;

mod canvas;
mod frontmatter;
mod graph;
mod index;
mod note;
mod queries;
mod query;
mod resolve;
mod snapshot;
mod tags;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use index::Vault;
// Borrowed by `commands/metadata.rs` and `commands/wikilinks.rs` so the tag
// rules and the snippet cap have one definition while both still ship.
pub use note::snippet_for;
pub use tags::inline_tags;
// Their tests name the caps; the code paths only reach them through the
// functions above.
#[cfg(test)]
pub use note::MAX_SNIPPET_CHARS;
#[cfg(test)]
pub use tags::{MAX_INLINE_TAGS_PER_FILE, MAX_TAG_CHARS};
