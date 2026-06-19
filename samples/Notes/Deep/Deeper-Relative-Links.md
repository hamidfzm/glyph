# Deeper Relative Links (two levels deep)

This note lives in `samples/Notes/Deep/`. From here it takes `../../` to reach
the workspace root, which is a good test that `..` chains resolve correctly and
still stay clamped to `samples/`.

## Up one level with `../`

`../` steps up to `Notes/`:

- [Cooking](../Cooking.md) — `../Cooking.md`
- [Relative Links](../Relative-Links.md) — back up to the one-level-deep demo

## Up two levels with `../../`

`../../` steps up to the workspace root (`samples/`):

- [the index](../../Index.md) — `../../Index.md`
- [the showcase](../../README.md) — `../../README.md`
- [the canvas demo](../../canvas-demo.canvas) — opens as a board

## Relative image, two levels up

![A relative image, two levels up](../../assets/relative-image.svg)

## Links that won't work

- [outside the workspace](../../../outside.md) — `../../../` escapes `samples/`; refused
- ![escaping image](../../../outside-image.svg) — renders nothing

Each `..` is resolved against this file's folder, then the final path is checked
against the open workspace. Anything landing outside it is never read.
