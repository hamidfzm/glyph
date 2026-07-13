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
