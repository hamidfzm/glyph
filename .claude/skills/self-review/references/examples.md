# Self-Review: worked examples and correction history

One section per checklist rule. Each entry is a real correction: what was rejected, what replaced it. Newest entries first within a section.

## Rule 1: readable over clever

- `isMobile(usePlatform()) === (on === "mobile")` was rejected as unreadable. Accepted shape: name the intermediate, then compare: `const current = isMobile(platform) ? "mobile" : "desktop"`.

## Rule 2: YAGNI

- A gate component shipped selector unions and list props with zero callers; all of it was cut. Generality is added by the PR that needs it.

## Rule 3: sparse comments

- Two PRs were bounced because comment lines rivaled code lines; step-narration and restated names were trimmed to the constraint-only comments.

## Rule 4: reuse and standard shapes

- A custom `"pluginApi": { "version", "compatFloor" }` block in package.json was rejected ("don't add nonstandard fields to package.json"). Accepted shape: the plugin API ceiling derives from the standard `version` field through the existing `__APP_VERSION__` Vite define (`PLUGIN_API_VERSION = __APP_VERSION__`), and the compat floor, a fact only the checker interprets, lives as a constant beside `satisfiesApiVersion` in `apiVersion.ts`.

## Rule 5: right altitude

- CodeQL flagged `js/xss-through-dom` on `link.setAttribute("href", value)` in the export fallback, where `value` came from a document attribute. Two guards were tried (a shared `exportableHref` helper, then the same regex inlined at the sink) and neither cleared the alert; each cost a push and a CI wait. Accepted shape: delete the sink. The fallback names the media instead of linking it, which is also the truer behavior, since no single-file export carries the bytes.

## Rule 6: tests assert the existing surface

- Three assertions in the media-export work passed for reasons other than their names. `expect(JSON.stringify(blocks)).toContain("clip.mp4")` was satisfied by the poster paragraph's `alt`, never reaching the name paragraph it claimed to check; `expect(html).not.toContain("<a")` also matches `<audio`; and a test named for the hast text-child guard passed with that guard deleted, because a text node has no `tagName` either way. Accepted shape: assert the exact node (`blocks[1]`, `'<p class="markdown-media-fallback"><em>clip.mp4</em></p>'`), and prove a new guard by reverting it and watching the test fail.

## Rule 7: a behavior change sweeps its descriptions

- The export fallback stopped emitting links, but `print.epubMedia.description` in all five locales still promised that over-limit media "becomes a link", and six comments plus three test names described the same removed behavior. A user reading Settings was told their 40 MB clip would become a link when it becomes a name. Accepted shape: grep the old behavior's vocabulary (`link`, `href`) across `src/`, `.claude/`, and `samples/` in the same commit that changes the behavior.

## Rule 8: a node added to the rendered document joins every DOM consumer

- A print-only `<span>` naming a media file was added to fix an empty player printing as a black box. It is `display: none` on screen, but `useSearch` walks every text node regardless of whether it renders, so searching a note for `demo` counted a match that could never be scrolled to or highlighted. Accepted shape: add the class to the walker's existing reject list beside `script, style, .mermaid-diagram`, and check the other consumers (`documentHighlight`, `prepareContent`'s `[data-export-ignore]` strip, the website pipeline) in the same change.
