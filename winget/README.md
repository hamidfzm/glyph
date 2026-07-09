# winget bootstrap

After the one-time bootstrap below, every release is automated: the
`publish-winget` job in [release.yml](../.github/workflows/release.yml) uses
[winget-releaser](https://github.com/vedantmgoyal9/winget-releaser) to open a
manifest-update PR against [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).

## One-time setup

1. Create a classic GitHub PAT with `public_repo` scope and add it to this
   repo's Actions secrets as `WINGET_GITHUB_TOKEN`. The token owner needs a
   fork of `microsoft/winget-pkgs` (winget-releaser creates one if missing).
2. Submit the initial manifest, since winget-releaser can only update a
   package that already exists upstream. Easiest path, from a Windows machine:

   ```powershell
   winget install wingetcreate
   wingetcreate new https://github.com/hamidfzm/glyph/releases/download/v<VERSION>/Glyph_<VERSION>_x64_en-US.msi
   ```

   Use `hamidfzm.Glyph` as the package identifier and the metadata from the
   templates in this directory ([version](hamidfzm.Glyph.yaml),
   [installer](hamidfzm.Glyph.installer.yaml),
   [locale](hamidfzm.Glyph.locale.en-US.yaml); `{{VERSION}}` and `{{SHA256}}`
   are filled from the release). `wingetcreate` validates and opens the PR to
   `microsoft/winget-pkgs` for you.
3. Once that first PR is merged upstream, the `publish-winget` job handles
   every subsequent release automatically.
