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

- (no recorded corrections yet)

## Rule 6: tests assert the existing surface

- (no recorded corrections yet)
