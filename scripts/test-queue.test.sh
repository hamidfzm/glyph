#!/usr/bin/env bash
# Tests scripts/test-queue.sh against a throwaway lock, with short sleeps
# standing in for the heavy commands.
set -euo pipefail

queue="$(cd "$(dirname "$0")" && pwd)/test-queue.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GLYPH_TEST_QUEUE_LOCK="$tmp/lock"
unset GLYPH_TEST_QUEUE_HELD
lock="$GLYPH_TEST_QUEUE_LOCK"
log="$tmp/log"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# Blocks until a command started in the background holds the lock
wait_for_holder() {
  local tries=0
  until [ -s "$lock/owner" ]; do
    tries=$((tries + 1))
    [ "$tries" -lt 100 ] || fail "nothing took the lock"
    sleep 0.1
  done
}

# A call without the `--` separator is rejected
code=0
bash "$queue" label true 2>/dev/null || code=$?
[ "$code" -eq 2 ] || fail "a call without -- exited $code, expected 2"

# The command's exit code is passed through, and the lock is released
code=0
bash "$queue" exits-seven -- sh -c 'exit 7' 2>/dev/null || code=$?
[ "$code" -eq 7 ] || fail "exit code was $code, expected 7"
[ ! -e "$lock" ] || fail "the lock outlived its command"

# Two commands started together run one after the other
bash "$queue" first -- sh -c 'echo first-start >> "$1"; sleep 3; echo first-end >> "$1"' sh "$log" 2>/dev/null &
wait_for_holder
err=$(bash "$queue" second -- sh -c 'echo second-start >> "$1"' sh "$log" 2>&1) || fail "the waiting command failed: $err"
wait
order=$(tr '\n' ' ' < "$log")
[ "$order" = "first-start first-end second-start " ] || fail "commands overlapped: $order"
echo "$err" | grep -q "second is waiting behind: first" || fail "the waiter did not name the holder: $err"

# A lock whose holder stopped refreshing it is taken over
mkdir "$lock"
echo ghost > "$lock/owner"
echo $(($(date +%s) - 1000)) > "$lock/heartbeat"
err=$(bash "$queue" taker -- true 2>&1) || fail "the command behind an abandoned lock failed: $err"
echo "$err" | grep -q "took over an abandoned lock: ghost" || fail "the abandoned lock was not taken over: $err"
[ ! -e "$lock" ] || fail "the taken-over lock was not released"

# A long-held lock read while its heartbeat is being rewritten (empty for a
# moment) is still a live lock
mkdir "$lock"
echo holder > "$lock/owner"
: > "$lock/heartbeat"
touch -t 200001010000 "$lock"
bash "$queue" patient -- sh -c 'echo patient-ran >> "$1"' sh "$log" 2>/dev/null &
sleep 2
grep -q patient-ran "$log" && fail "a lock caught mid-heartbeat was taken over"
rm -rf "$lock"
wait
grep -q patient-ran "$log" || fail "the waiter never ran after the lock was released"

# A holder whose lock was taken over leaves the new holder's lock alone
bash "$queue" overstayed -- sleep 2 2>/dev/null &
wait_for_holder
echo "new holder" > "$lock/owner"
wait
[ -d "$lock" ] || fail "a holder removed a lock it no longer owned"

# A command already inside the queue runs at once instead of waiting behind
# the lock it is running under (the pre-commit hook inside a queued commit)
date +%s > "$lock/heartbeat"
code=0
err=$(GLYPH_TEST_QUEUE_HELD=1 bash "$queue" nested -- sh -c 'exit 5' 2>&1) || code=$?
[ "$code" -eq 5 ] || fail "nested exit code was $code, expected 5"
[ -z "$err" ] || fail "the nested command waited: $err"
[ -d "$lock" ] || fail "the nested command released a lock it did not take"
rm -rf "$lock"
held=$(bash "$queue" outer -- sh -c 'echo "$GLYPH_TEST_QUEUE_HELD"' 2>/dev/null) || fail "the command failed"
[ "$held" = 1 ] || fail "the command was not told it holds the queue"

# Where the lock can never be made, the command runs instead of waiting forever
code=0
err=$(GLYPH_TEST_QUEUE_LOCK="$tmp/missing/lock" bash "$queue" unqueued -- sh -c 'exit 4' 2>&1) || code=$?
[ "$code" -eq 4 ] || fail "exit code without a usable lock was $code, expected 4"
echo "$err" | grep -q "without the queue" || fail "running unqueued was not reported: $err"

echo "OK: the queue serializes commands, passes exit codes through, and recovers abandoned locks"
