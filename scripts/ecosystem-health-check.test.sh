#!/usr/bin/env bash
# Tests the download helpers of scripts/ecosystem-health-check.sh against a
# stub curl: the marketplace index supplies the package URLs, so a URL must be
# treated as data and never as a curl option.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
script="$repo_root/scripts/ecosystem-health-check.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

test_fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# The stub records its arguments and succeeds only for https://ok/ URLs.
mkdir "$tmp/bin"
cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CURL_ARGS"
case "${*: -1}" in https://ok/*) exit 0 ;; *) exit 22 ;; esac
STUB
chmod +x "$tmp/bin/curl"
export PATH="$tmp/bin:$PATH" CURL_ARGS="$tmp/curl-args"

# Load only CURL, fetch and reachable; the script's fail/ok are stubbed here.
failed=0
fail() { failed=1; }
ok() { :; }
eval "$(sed -n '/^CURL=(/p; /^fetch()/,/^}$/p; /^reachable()/,/^}$/p' "$script")"

# An https URL is downloaded, passed as the last argument after `--`.
fetch "https://ok/plugin.zip" "$tmp/out" || test_fail "https download refused"
grep -qx -- "--" "$CURL_ARGS" || test_fail "fetch did not pass -- before the URL"
[ "$(tail -1 "$CURL_ARGS")" = "https://ok/plugin.zip" ] || test_fail "URL is not curl's last argument"

# A URL that starts with - or is not https is refused before curl runs.
for bad in "--output=/etc/passwd" "-o/etc/passwd" "http://ok/plugin.zip" "ftp://ok/plugin.zip" ""; do
  rm -f "$CURL_ARGS"; failed=0
  if fetch "$bad" "$tmp/out"; then test_fail "accepted '$bad'"; fi
  [ ! -e "$CURL_ARGS" ] || test_fail "curl ran for '$bad'"
  [ "$failed" = 1 ] || test_fail "'$bad' was not reported"
done

# A failed download is reported, not fatal.
failed=0
if fetch "https://down/plugin.zip" "$tmp/out"; then test_fail "download failure passed"; fi
[ "$failed" = 1 ] || test_fail "download failure was not reported"

# reachable passes its URL after `--` too.
reachable "https://ok/" || test_fail "reachable refused https"
grep -qx -- "--" "$CURL_ARGS" || test_fail "reachable did not pass -- before the URL"

echo "ok: ecosystem-health-check.sh download helpers"
