# Sibling Repos (glyph-md org)

Rules for working across the Glyph ecosystem's satellite repositories.

The main repo is `hamidfzm/glyph`. Every satellite (Homebrew tap, Scoop bucket, apt/rpm repos, plugin marketplace, plugin template, export-website action, org profile, and the `glyph-md.github.io` website) lives in the **glyph-md** GitHub org.

- **Clone all satellites into `../glyph-md/<repo>`**, a `glyph-md/` directory **adjacent to this repo** (i.e. next to the `glyph` checkout), not inside a worktree or a temp dir. Make cross-repo changes there so the working copies persist between sessions instead of re-cloning each time.

- **Clone over HTTPS with the gh token, push over SSH.** SSH auth isn't loaded in the Bash tool, so clone with `$(gh auth token)`, then reset `origin` to the SSH URL for pushing (SSH works from PowerShell). Never commit a remote URL with the token baked in.

  ```bash
  mkdir -p ../glyph-md && cd ../glyph-md
  TOKEN=$(gh auth token)
  for r in $(gh repo list glyph-md --limit 100 --json name -q '.[].name'); do
    [ -d "$r/.git" ] && (cd "$r" && git pull --ff-only) && continue
    git clone "https://x-access-token:${TOKEN}@github.com/glyph-md/$r.git" "$r"
    git -C "$r" remote set-url origin "git@github.com:glyph-md/$r.git"  # scrub token; push over SSH
  done
  ```

## Namespace and website

- **The main repo stays `hamidfzm/glyph`** (decided in #128); the org holds only satellites. Create any new satellite repo under `glyph-md/`, and keep `hamidfzm/glyph` URLs in README/workflows as-is.
- **The marketing website** is `glyph-md/glyph-md.github.io` (Astro, GitHub Pages, 5 locales in `src/i18n/ui.ts`), cloned at `../glyph-md/glyph-md.github.io`.
- **Canonical install/docs URL is the `homepage` field of this repo's `package.json`** (currently `https://glyph-md.github.io`; the release workflow reads it with `jq`). Do not switch prose or package-repo URLs to the `glyph.md` custom domain until `package.json` flips first; a premature switch has been fully reverted before.

## Satellite gotchas

- **PR APIs 404 on repos with Issues disabled** (`homebrew-tap`, `scoop-bucket`): GitHub's `/pulls` endpoints ride on the issues subsystem, so `gh pr create` fails even with admin. Either enable Issues first, or push doc-level changes to `main` directly via the contents API.
- **Plugin API phases ship ecosystem-wide**: any change to `ctx.*`, manifest fields, or registry entry fields also updates `glyph-md/plugin-template` (`types/glyph.d.ts`, "API vX.Y" header) and `glyph-md/plugins` (`docs/api-reference.md`, `index.schema.json`, CONTRIBUTING) in the same delivery, with matching `PLUGIN_API_VERSION`.
