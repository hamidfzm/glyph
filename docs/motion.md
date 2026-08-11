# Motion, Materials, and Press States

Glyph's interaction foundation (issue #529). Three pieces: an interruptible
spring layer, translucent materials for floating chrome, and instant press
feedback. All motion animates only `transform` and `opacity`, and everything
respects `prefers-reduced-motion` (see the global reset in `src/styles/app.css`)
and `prefers-reduced-transparency` (fallbacks in `src/styles/motion.css`).

## Springs (`src/lib/spring.ts`)

Springs are parameterized as **response** (seconds, lower = snappier) and
**damping ratio** (1 = critically damped, no overshoot). `SPRING_DEFAULT`
(`response 0.3, dampingRatio 1`) fits UI chrome; reserve damping below 1 for
surfaces the user just flicked. There is no fixed duration anywhere: settle
time emerges from the parameters, and a spring can be retargeted mid-flight
without a jump because it always continues from its current value and velocity.

- `stepSpring` / `isSettled`: the pure integrator.
- `createSpringAnimation`: the rAF driver. `animateTo(target, velocity?)`
  retargets (the optional velocity is the gesture handoff), `moveTo(value)`
  hands the value to a drag, `stop()` freezes in place (grabbing a moving
  surface). Under reduced motion it snaps to the target and settles instantly.

## Presence (`src/hooks/useSpringPresence.ts`)

Mount/unmount with a real exit phase. The hook writes `--presence` (0 closed,
1 open) on the bound element each frame, and marks the element `inert` while
exiting so a dismissing surface can't take clicks, keystrokes, focus, or
screen-reader attention; the surface's CSS maps `--presence` onto
transform/opacity (see the mappings in `src/styles/motion.css`). Used by the
command palette and the settings modal. Enter and exit run along the same
path, and reopening mid-close reverses from wherever the surface currently is.

## The gesture sheet (`src/hooks/useDrawerGesture.ts`)

The compact sidebar drawer is the first momentum surface: springs in on mount,
tracks a horizontal drag 1:1 (vertical scrolls win via an axis threshold),
rubberbands past the open edge, and on release projects the momentum
(`project` in `src/lib/gesture.ts`) to decide open vs dismiss, handing the
release velocity to the settle spring. Dismissals registered in
`useSidebarLayout`'s `drawerDismissals` let `closeCompactPanels` (backdrop
tap, opening a file) play the same exit spring before unmounting.

## Materials

Floating chrome (command palette, modals, sidebar drawer, status bar) sits on
a translucent layer: `--glyph-material-bg` / `--glyph-material-edge` (theme
colors in `app.css`) and `--glyph-material-blur` / `--glyph-sidebar-filter`
(platform vars in `platform.css`), applied in `motion.css`. The inset top
highlight is the light catching the material's edge. Blur is spent only where
content actually passes behind the surface: overlays always blur, the docked
sidebar blurs per platform via `--glyph-sidebar-filter` (macOS vibrancy,
`none` elsewhere), and the docked status bar takes the tint without a filter.
`prefers-reduced-transparency` swaps every material for the solid surface
color; tune a platform's treatment via the vars rather than per component.

## Press states

Feedback lands on pointer-down, never on release:

- Button-like controls compress: the `pressable` class (or the grouped
  `:active` rules in `motion.css` for stylesheet-styled controls).
- Rows and list items tint: `active:bg-[var(--color-border)]` next to their
  hover class, or an accent tint where selection already uses accent.

New interactive controls get one of these on day one.
