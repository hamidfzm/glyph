#!/usr/bin/env bash
# Runs one heavy command at a time across every Glyph checkout on this machine.
#
#   bash scripts/test-queue.sh <label> -- <command> [args...]
#
# Waits its turn, runs the command, and exits with the command's exit code.
# The label is what other waiters see while this command holds the queue.
#
# The lock is a directory in the system temp dir, so every worktree shares it.
# Its holder refreshes a heartbeat; a lock whose heartbeat stopped is treated
# as abandoned and taken over. GLYPH_TEST_QUEUE_LOCK moves the lock (the tests
# use it to stay out of the real queue).
set -u

if [ $# -lt 3 ] || [ "$2" != "--" ]; then
  echo "usage: test-queue.sh <label> -- <command> [args...]" >&2
  exit 2
fi
label=$1
shift 2

# Already inside the queue: a queued `git commit` reaches the pre-commit hook,
# which queues its own heavy steps and would otherwise wait behind itself.
if [ -n "${GLYPH_TEST_QUEUE_HELD:-}" ]; then
  exec "$@"
fi

lock=${GLYPH_TEST_QUEUE_LOCK:-/tmp/glyph-test-queue.lock}
poll=10          # seconds between attempts to take the lock
stale_after=180  # seconds without a heartbeat before a lock counts as abandoned
max_hold=5400    # a holder stops refreshing after this long, so nothing holds forever

# The pre-commit hook runs this for everyone: where no lock can ever be made,
# run the command instead of waiting forever.
if [ ! -w "$(dirname "$lock")" ]; then
  echo "[queue] cannot write to $(dirname "$lock"): running $label without the queue" >&2
  exec "$@"
fi

waited=0
silent=0  # seconds of back-to-back polls that found no readable heartbeat
until mkdir "$lock" 2>/dev/null; do
  beat=$(cat "$lock/heartbeat" 2>/dev/null)
  case $beat in
    '' | *[!0-9]*)
      # Just taken, or caught mid-write: only a long run of these means abandoned.
      silent=$((silent + poll))
      age=$silent
      ;;
    *)
      silent=0
      age=$(($(date +%s) - beat))
      ;;
  esac
  # Rename first: of the waiters that see the stale lock, only one gets it.
  if [ "$age" -gt "$stale_after" ] && mv "$lock" "$lock.abandoned.$$" 2>/dev/null; then
    echo "[queue] took over an abandoned lock: $(cat "$lock.abandoned.$$/owner" 2>/dev/null || echo unknown)" >&2
    rm -rf "$lock.abandoned.$$"
    silent=0
    continue
  fi
  if [ $((waited % 60)) -eq 0 ]; then
    echo "[queue] $label is waiting behind: $(cat "$lock/owner" 2>/dev/null || echo unknown)" >&2
  fi
  sleep "$poll"
  waited=$((waited + poll))
done

date +%s > "$lock/heartbeat"
owner="$label (running since $(date +%H:%M:%S))"
echo "$owner" > "$lock/owner"

main=$$
# Detached from our directory and output: the `sleep` this leaves behind on
# exit must not pin the worktree (Windows) or keep a caller's pipe open.
(
  cd /
  held=0
  while sleep 30; do
    kill -0 "$main" 2>/dev/null || exit 0
    held=$((held + 30))
    [ "$held" -lt "$max_hold" ] || exit 0
    date +%s > "$lock/heartbeat" || exit 0
  done
) </dev/null >/dev/null 2>&1 &
beater=$!

release() {
  kill "$beater" 2>/dev/null
  # Only our own lock: past max_hold it may have been taken over.
  [ "$(cat "$lock/owner" 2>/dev/null)" != "$owner" ] || rm -rf "$lock"
}
trap release EXIT
trap 'exit 130' INT TERM

echo "[queue] $label is running (waited ${waited}s)" >&2
export GLYPH_TEST_QUEUE_HELD=1
"$@"
