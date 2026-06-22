# Relative Links (one level deep)

This note lives in `samples/Notes/`. With the `samples/` folder open as a
workspace, every working link below resolves against *this* file's folder and
opens in-app. Paths are clamped to the workspace, so anything that climbs above
`samples/` is refused.

## Same folder

- [Cooking](./Cooking.md) — sibling note via `./`
- [Ingredients](Ingredients.md) — sibling note, no prefix
- [Techniques](Techniques.md)

## Up one level with `../`

`../` steps up from `Notes/` to the workspace root (`samples/`):

- [the index](../Index.md) — `../Index.md`
- [the showcase](../README.md) — `../README.md`
- [the canvas demo](../canvas-demo.canvas) — `../canvas-demo.canvas`, opens as a board

## Relative images

Images resolve the same way. This one walks up to the shared assets folder:

![A relative image, one level up](../assets/relative-image.svg)

And this reuses the showcase diagram at the workspace root:

![The Glyph diagram](../diagram.svg)

## Links that won't work

These are intentionally broken to show the guard rails:

- [outside the workspace](../../outside.md) — `../../` escapes `samples/`, so it is **not** followed
- [system file](../../../secret.md) — climbs well above the workspace; refused
- ![escaping image](../../outside-image.svg) — a relative image above the root renders nothing

Opening this file on its own (no folder open) leaves every relative link to the
browser instead.
