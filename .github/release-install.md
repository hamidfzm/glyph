## Install

### macOS
```bash
brew tap glyph-md/tap && brew trust glyph-md/tap && brew install --cask --force glyph-md/tap/glyph
```
Or download `Glyph_*_universal.dmg` below.

### Windows
```powershell
# winget
winget install hamidfzm.Glyph

# Chocolatey
choco install glyph

# Scoop
scoop bucket add glyph-md https://github.com/glyph-md/scoop-bucket
scoop install glyph
```
Or download `Glyph_*_x64_en-US.msi` below.

### Linux
```bash
# Snap Store
sudo snap install glyph

# Arch (AUR)
yay -S glyph-md-bin

# Homebrew (Linuxbrew)
brew tap glyph-md/tap && brew install glyph-md/tap/glyph

# Debian/Ubuntu (PPA)
sudo add-apt-repository ppa:hamidfzm/glyph
sudo apt update
sudo apt install glyph

# Debian (apt repo)
curl -fsSL https://glyph-md.github.io/apt-repo/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/glyph.gpg
echo "deb [signed-by=/usr/share/keyrings/glyph.gpg] https://glyph-md.github.io/apt-repo stable main" | sudo tee /etc/apt/sources.list.d/glyph.list
sudo apt update && sudo apt install glyph

# Fedora/RHEL (dnf)
sudo tee /etc/yum.repos.d/glyph.repo < <(curl -fsSL https://glyph-md.github.io/rpm-repo/glyph.repo)
sudo dnf install glyph
```
Or download the `.deb` / `.rpm` / `.AppImage` below.

On Arch, when the AUR lags behind a release, download the `PKGBUILD` asset below and run `makepkg -si` next to it.

### No internet on the target machine
- **Windows:** download `Glyph_*_x64_en-US_offline.msi` below. It carries the WebView2 runtime Glyph needs, so it is over 200 MB.
- **macOS:** the `.dmg` below needs nothing else.
- **Linux:** the `.AppImage` below carries its own libraries. On a machine with no FUSE, run it with `--appimage-extract` and start `squashfs-root/AppRun`.
