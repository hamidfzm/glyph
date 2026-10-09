/** What a canvas board renders for three text cards: a `.markdown-body` each,
 *  and no document scroller. */
export const CANVAS_CARDS_HTML = ["first", "second", "third"]
  .map((text) => `<div class="glyph-canvas-node-text markdown-body"><p>${text}</p></div>`)
  .join("");
