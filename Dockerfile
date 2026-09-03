# Glyph's headless exports in a container: a docs folder in, a static website
# out, with no need to install the desktop app or chase its dependency chain.
#
# The export is rendered by the app's own webview, so this image carries the
# WebKitGTK stack the `.deb` pulls in plus an X server to render into. That is
# the same shape as the Linux CI and release smoke tests, which run the CLI
# against a virtual display.
FROM debian:bookworm-slim

# The release to install, without the leading "v" (e.g. 0.22.1). Pinned at
# build time so an image always maps to one published release, never to
# whatever "latest" happens to mean when it is rebuilt.
ARG GLYPH_VERSION
# Set per platform by buildx. `amd64` / `arm64` is exactly how the release
# names its Debian packages, so one Dockerfile covers both architectures.
ARG TARGETARCH

# WebKit's compositing path has no GPU under Xvfb and crashes without this.
# The release smoke tests set the same variable on every Linux distro.
ENV WEBKIT_DISABLE_COMPOSITING_MODE=1
# WebKit wants a writable home. Pointing it at /tmp keeps the image working
# under `--user` with an arbitrary uid, which is how anyone writing to a
# bind-mounted output directory will run it.
ENV HOME=/tmp

# The published Debian package, not a source build: the image then contains
# byte-for-byte what the apt repository serves for the same version.
ADD https://github.com/hamidfzm/glyph/releases/download/v${GLYPH_VERSION}/Glyph_${GLYPH_VERSION}_${TARGETARCH}.deb /tmp/glyph.deb

# Installing the .deb through apt (rather than dpkg) resolves its own GTK and
# WebKitGTK dependencies; only the X server is extra.
#
# The purge runs in this same layer on purpose: image layers are additive, so
# deleting in a later step leaves the bytes in the image and saves nothing.
#
# WebKitGTK declares more than a headless export uses: GStreamer's codecs are
# for media playback and the icon theme is for a desktop nobody sees here.
# `--force-depends` because they are declared dependencies of WebKit, so the
# CI smoke test is what keeps this honest.
#
# Two things that look equally unused are not, and must stay: Mesa's DRI
# driver with the LLVM it drags in (the largest single item in the image, but
# WebKit still initialises EGL and dies with "Could not create surfaceless EGL
# display" without it, even with compositing disabled), and libflite, WebKit's
# speech synthesiser, which it links directly.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        /tmp/glyph.deb \
        xvfb \
        ca-certificates \
    && dpkg --purge --force-depends \
        adwaita-icon-theme \
        gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-base \
    && rm -rf \
        /var/lib/apt/lists/* \
        /tmp/glyph.deb \
        /usr/share/doc \
        /usr/share/man \
        /usr/share/info \
        /usr/share/locale \
        /var/cache/debconf/*

# Exports land on a bind mount, so running as root would leave root-owned
# files on the host. Callers whose uid is not 1000 can override with
# `--user "$(id -u):$(id -g)"`.
RUN useradd --create-home --uid 1000 glyph

COPY docker-entrypoint.sh /usr/local/bin/glyph-entrypoint
RUN chmod +x /usr/local/bin/glyph-entrypoint

USER glyph
WORKDIR /docs

# The container's arguments are Glyph's arguments, so every documented flag
# works here without a second CLI to learn. The default renders the folder
# mounted at /docs into /out.
#
# This spelling tracks the *released* CLI, not this checkout's: the image
# installs a published .deb, so the default command may only use syntax that
# release already has. `glyph export <path> --format site` replaces it, and
# flipping it here has to wait for the release that carries the subcommand.
# The Docker CI job is what enforces that, by building against the latest
# release and running this command.
ENTRYPOINT ["/usr/local/bin/glyph-entrypoint"]
CMD ["/docs", "--export", "site", "--out", "/out"]
