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
//! - [`store`] caches one index per workspace behind the grant check, for the
//!   Tauri [`commands`], the watcher, and `glyph mcp` alike.

pub mod commands;

mod canvas;
mod frontmatter;
mod graph;
mod headings;
mod index;
mod note;
mod queries;
mod query;
mod resolve;
mod slug_table;
mod snapshot;
mod store;
mod tags;

#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;

pub(crate) use frontmatter::{parse_frontmatter, split_frontmatter, Frontmatter};
pub(crate) use headings::{js_lines, parse_headings, section, slug};
pub(crate) use index::strip_bom;
pub use index::Vault;
pub use queries::Direction;
pub(crate) use resolve::split_heading;
pub(crate) use store::with_synced_vault;
pub use store::{apply_changes, forget, VaultStore};
