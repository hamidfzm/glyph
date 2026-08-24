#!/usr/bin/env bash
# Read-only health check of the published ecosystem endpoints (#506): the apt
# and dnf repos (metadata, GPG signatures, advertised version), the website,
# and the plugin marketplace index. Run weekly by ecosystem-health.yml; runs
# anywhere with curl, gpg, jq, python3, and check-jsonschema on PATH.
#
# Every failing assertion is reported (not just the first), then the script
# exits non-zero if any failed.
set -euo pipefail

expected="${1:-}"
if ! echo "$expected" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "usage: $0 <released version, e.g. 0.21.0>" >&2
  exit 2
fi

# A missing tool must not read as a broken endpoint. The python3 probe also
# catches the Windows Store stub that sits on PATH but cannot run anything.
for tool in curl gpg jq gzip sha256sum python3 check-jsonschema; do
  command -v "$tool" >/dev/null || { echo "missing on PATH: $tool" >&2; exit 2; }
done
python3 -c 'import xml.etree.ElementTree' 2>/dev/null || { echo "python3 on PATH does not run" >&2; exit 2; }

APT_REPO="https://glyph-md.github.io/apt-repo"
RPM_REPO="https://glyph-md.github.io/rpm-repo"
WEBSITE="https://glyph-md.github.io"
MARKETPLACE="https://raw.githubusercontent.com/glyph-md/plugins/main"

# Release signing key (release.yml publish-debian / publish-dnf). Both repos
# serve it as gpg.key, so a signature check against the served key would only
# prove the repo is self-consistent; pinning the fingerprint makes it "signed by
# our key", and a swapped key file fails too.
SIGNING_KEY_FPR="D086479C8F620CA12BAE84B9D3B6C7512091E587"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GNUPGHOME="$tmp/gnupg"
mkdir "$GNUPGHOME"
# gpg only warns on loose permissions; Git Bash on Windows cannot chmod /tmp.
chmod 700 "$GNUPGHOME" 2>/dev/null || true

failed=0
fail() { echo "::error::$*"; failed=1; }
ok() { echo "ok: $*"; }

# Bounded timeouts so one blackholed host cannot eat the job timeout and hide
# the sections after it; https only, including across redirects.
CURL=(curl -fsSL --retry 3 --retry-all-errors --connect-timeout 20 --max-time 120 --proto =https --proto-redir =https)

fetch() { # fetch <url> <out>
  "${CURL[@]}" -o "$2" "$1" || { fail "$1: download failed"; return 1; }
}

reachable() { # reachable <url>
  "${CURL[@]}" -I -o /dev/null "$1" || { fail "$1: unreachable"; return 1; }
}

import_signing_key() { # import_signing_key <url>
  fetch "$1" "$tmp/gpg.key" || return 1
  local fpr
  fpr=$(gpg --batch --show-keys --with-colons "$tmp/gpg.key" 2>/dev/null | awk -F: '$1 == "fpr" {print $10; exit}')
  if [ "$fpr" != "$SIGNING_KEY_FPR" ]; then
    fail "$1: fingerprint ${fpr:-unreadable}, expected $SIGNING_KEY_FPR"
    return 1
  fi
  gpg --batch --import "$tmp/gpg.key" 2>/dev/null
}

check_apt() {
  local d="$tmp/apt"
  mkdir -p "$d"
  import_signing_key "$APT_REPO/gpg.key" || return 0
  fetch "$APT_REPO/dists/stable/InRelease" "$d/InRelease" || return 0
  if gpg --batch --verify "$d/InRelease" 2>/dev/null; then
    ok "apt InRelease signed by $SIGNING_KEY_FPR"
  else
    fail "apt InRelease: signature missing or not by $SIGNING_KEY_FPR"
  fi
  for arch in amd64 arm64; do
    fetch "$APT_REPO/dists/stable/main/binary-$arch/Packages" "$d/Packages.$arch" || continue
    # dpkg-scanpackages lists every pooled deb; the newest is what apt installs.
    local have
    have=$(awk '$1 == "Version:" {print $2}' "$d/Packages.$arch" | sort -V | tail -1)
    if [ "$have" = "$expected" ]; then
      ok "apt $arch serves $have"
    else
      fail "apt $arch: serves ${have:-nothing}, expected $expected"
    fi
  done
}

check_dnf() {
  local d="$tmp/rpm"
  mkdir -p "$d"
  import_signing_key "$RPM_REPO/gpg.key" || return 0
  fetch "$RPM_REPO/glyph.repo" "$d/glyph.repo" || return 0
  if grep -qx "baseurl=$RPM_REPO" "$d/glyph.repo" && grep -qx "gpgkey=$RPM_REPO/gpg.key" "$d/glyph.repo"; then
    ok "dnf glyph.repo points at $RPM_REPO"
  else
    fail "dnf glyph.repo: baseurl or gpgkey does not point at $RPM_REPO"
  fi
  fetch "$RPM_REPO/repodata/repomd.xml" "$d/repomd.xml" || return 0
  fetch "$RPM_REPO/repodata/repomd.xml.asc" "$d/repomd.xml.asc" || return 0
  if gpg --batch --verify "$d/repomd.xml.asc" "$d/repomd.xml" 2>/dev/null; then
    ok "dnf repomd.xml signed by $SIGNING_KEY_FPR"
  else
    fail "dnf repomd.xml: signature missing or not by $SIGNING_KEY_FPR"
  fi
  # createrepo_c --revision "$VERSION" (release.yml) is the advertised version;
  # an unparseable file fails here with an empty revision.
  # tr strips the CRLF that python and jq emit on Windows, so the script
  # stays runnable from Git Bash as CONTRIBUTING.md promises.
  local revision="" primary=""
  { read -r revision; read -r primary; } < <(python3 -c '
import sys, xml.etree.ElementTree as ET
ns = "{http://linux.duke.edu/metadata/repo}"
root = ET.parse(sys.argv[1]).getroot()
print(root.findtext(ns + "revision", ""))
loc = root.find(ns + "data[@type=\"primary\"]/" + ns + "location")
print("" if loc is None else loc.get("href", ""))
' "$d/repomd.xml" | tr -d '\r') || true
  if [ "$revision" = "$expected" ]; then
    ok "dnf repomd.xml revision $revision"
  else
    fail "dnf repomd.xml: revision ${revision:-unparseable}, expected $expected"
  fi
  # The package index repomd points at must exist and list the release, or dnf
  # sees a valid repo with nothing to install.
  [ -n "$primary" ] || { fail "dnf repomd.xml: no primary location"; return 0; }
  fetch "$RPM_REPO/$primary" "$d/primary.xml.gz" || return 0
  gzip -dc "$d/primary.xml.gz" > "$d/primary.xml" || { fail "dnf primary.xml.gz: not gzip"; return 0; }
  if grep -q "ver=\"$expected\"" "$d/primary.xml"; then
    ok "dnf primary.xml lists $expected"
  else
    fail "dnf primary.xml: does not list $expected"
  fi
}

check_website() {
  # The homepage holds the install instructions (#download); the locale roots
  # are the pages the language switcher links to.
  local path
  for path in / /de/ /es/ /fa/ /zh/ /plugins/; do
    reachable "$WEBSITE$path" && ok "website $path"
  done
  fetch "$WEBSITE/" "$tmp/home.html" || return 0
  if grep -q 'id="download"' "$tmp/home.html"; then
    ok "website homepage has the #download section"
  else
    fail "website homepage: no #download section"
  fi
}

check_marketplace() {
  local d="$tmp/marketplace"
  mkdir -p "$d"
  fetch "$MARKETPLACE/index.json" "$d/index.json" || return 0
  fetch "$MARKETPLACE/index.schema.json" "$d/index.schema.json" || return 0
  if check-jsonschema --schemafile "$d/index.schema.json" "$d/index.json" >/dev/null; then
    ok "marketplace index validates against index.schema.json"
  else
    fail "marketplace index: schema validation failed"
  fi
  # Every listed package must download and match the index checksum the app
  # verifies on install, or the Install button ends in a dead link or a
  # checksum-mismatch error.
  local url sha n=0
  while read -r url sha; do
    n=$((n + 1))
    fetch "$url" "$d/package-$n.zip" || continue
    if echo "$sha  $d/package-$n.zip" | sha256sum -c --quiet >/dev/null 2>&1; then
      ok "marketplace package $url"
    else
      fail "marketplace package $url: sha256 does not match the index"
    fi
  done < <(jq -r '.plugins[] | "\(.packageUrl) \(.sha256)"' "$d/index.json" | tr -d '\r')
}

check_apt
check_dnf
check_website
check_marketplace

[ "$failed" -eq 0 ] || exit 1
echo "all ecosystem endpoints healthy for $expected"
