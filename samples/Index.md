# Index

A small linked workspace used to demo Glyph's wikilink resolution. Browse to:

- [[README|Feature showcase]] — every renderer feature in one file
- [[Notes/Cooking]] — example note in a subdirectory
- [[Graph View]] is a guide to the workspace graph (press `Cmd/Ctrl+G` to see this workspace mapped)

## Setup

To explore wikilinks live:

1. Launch Glyph.
2. `Cmd/Ctrl+Shift+O` and pick the `samples/` folder.
3. Click any of the `[[...]]` links above.

## Tags and metadata

The notes under `Notes/` carry frontmatter (`tags:`, `status:`), and inline `#tag` tokens count too. Glyph indexes both across the workspace, so with `samples/` open you can:

- Pick a tag in the **Tags** panel at the bottom of the Files sidebar to list only the notes carrying it (`#cooking` matches three of them). Pick it again, or use the panel's clear button, to get the tree back.
- Search by metadata in the command palette (`Cmd/Ctrl+K`): `tag:cooking`, `status:draft`, `status:draft sear`. Filters combine, and anything left over is matched against file names as usual.

## How resolution works

A wikilink target is matched case-insensitively against the workspace's markdown files by stem (filename without extension). When the target contains a slash, Glyph treats it as a relative path suffix — that's how `[[Notes/Cooking]]` lands on `samples/Notes/Cooking.md` and not on a stray `Cooking.md` elsewhere.

If two notes share a stem, Glyph prefers the one in the same directory as the current file; otherwise it picks the shortest path. Unresolved targets render with a muted, dashed-underline style.
