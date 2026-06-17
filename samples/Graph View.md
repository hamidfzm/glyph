# Graph View

The graph view draws your whole workspace as a force-directed map: every
markdown note is a **node**, and every resolved `[[wikilink]]` is an **edge**.
It is the bird's-eye companion to the per-note **Backlinks** panel. Instead of
"what links here", it shows how the entire vault hangs together.

## Open it

- Menu: **View > Open Graph**
- Keyboard: **Cmd/Ctrl + G**
- Command palette (**Cmd/Ctrl + K**): type "Open Graph"

A folder workspace has to be open first (the graph needs notes to map), so open
the `samples/` folder and try it on this very workspace.

## What you are looking at

- **Hubs.** Well-connected notes draw a larger dot. [[Index]] and this guide
  link out to several notes, so they sit near the busy centre.
- **Clusters.** Notes that mostly link to each other pull together. The cooking
  notes ([[Notes/Cooking]], [[Ingredients]], [[Techniques]]) form their own
  little knot off to one side.
- **Orphans.** Notes with no resolved links in or out render muted. The
  `Scratchpad` note (open it from the file tree) is deliberately unlinked, so it
  floats alone and dimmed where you can spot one.
- **Broken links never appear.** A `[[Missing]]` target is dropped rather than
  drawn, so the graph only ever shows real connections.

## Interacting

| Action | How |
| --- | --- |
| Open a note | Click its node |
| Highlight a note's neighbours | Hover it (the rest dim, arrows show link direction) |
| Pan | Drag the background |
| Zoom | Scroll or pinch |
| Re-centre | **Reset view** button (top-right) |

The graph stays live: create or delete a note, or edit a wikilink, and the map
re-shapes on the next save, with no manual refresh.

## Related

- [[Index]] is the workspace entry point.
- [[README]] is the full feature showcase.
- [[Notes/Cooking]] is the note the cooking cluster grows from.
