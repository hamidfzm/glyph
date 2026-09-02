#!/bin/sh
# Give Glyph a display, then hand the process over to it.
#
# `xvfb-run` would be the obvious wrapper, but it does not return once Glyph
# exits when the export target is a bind mount, leaving the container hung
# with the work already finished. Starting Xvfb directly and `exec`ing Glyph
# avoids the wrapper's teardown entirely, and makes the container's exit
# status Glyph's own, which is what lets a CI step fail on a failed export.
set -e

Xvfb :99 -screen 0 1280x1024x24 >/dev/null 2>&1 &

# Xvfb takes a moment to accept connections, and Glyph exits immediately if it
# cannot open the display. Five seconds is far longer than the observed
# startup and still fails loudly rather than hanging.
i=0
while [ ! -e /tmp/.X11-unix/X99 ]; do
    i=$((i + 1))
    if [ "$i" -gt 50 ]; then
        echo "glyph: Xvfb did not start" >&2
        exit 1
    fi
    sleep 0.1
done

export DISPLAY=:99
exec glyph "$@"
