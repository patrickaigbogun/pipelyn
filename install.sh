#!/usr/bin/env sh
# install.sh — Pipelyn one-line installer for Linux and macOS
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/patrickaigbogun/pipelyn/main/install.sh | sh
#
# Environment overrides:
#   PIPELYN_VERSION   — pin a specific release tag (e.g. v1.0.0); defaults to latest
#   PIPELYN_INSTALL_DIR — where to unpack the release (default: ~/.local/lib/pipelyn)
#   PIPELYN_BIN_DIR   — where to put the `pipelyn` launcher (default: ~/.local/bin)

set -eu

REPO="patrickaigbogun/pipelyn"
INSTALL_DIR="${PIPELYN_INSTALL_DIR:-$HOME/.local/lib/pipelyn}"
BIN_DIR="${PIPELYN_BIN_DIR:-$HOME/.local/bin}"

# ── Detect OS ──────────────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  PLATFORM="linux"  ;;
  darwin) PLATFORM="darwin" ;;
  *)
    echo "ERROR: Unsupported OS: $OS" >&2
    echo "  Supported: linux, darwin" >&2
    echo "  For Windows use: install.ps1" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH_SLUG="x64"   ;;
  arm64|aarch64) ARCH_SLUG="arm64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH" >&2
    echo "  Supported: x86_64, arm64" >&2
    exit 1
    ;;
esac

TARGET="${PLATFORM}-${ARCH_SLUG}"

# ── Resolve version ────────────────────────────────────────────────────────
if [ -z "${PIPELYN_VERSION:-}" ]; then
  PIPELYN_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
fi

if [ -z "$PIPELYN_VERSION" ]; then
  echo "ERROR: Could not determine latest release version." >&2
  echo "  Set PIPELYN_VERSION=vX.Y.Z to pin a specific version." >&2
  exit 1
fi

TARBALL="pipelyn-${PIPELYN_VERSION}-${TARGET}.tar.gz"
BASE_URL="https://github.com/${REPO}/releases/download/${PIPELYN_VERSION}"

echo ""
echo "  Pipelyn ${PIPELYN_VERSION} for ${TARGET}"
echo "  Installing to ${INSTALL_DIR}"
echo ""

# ── Download ───────────────────────────────────────────────────────────────
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ${TARBALL} ..."
curl -fsSL -o "$TMP/$TARBALL" "${BASE_URL}/${TARBALL}"

# ── Verify checksum ────────────────────────────────────────────────────────
echo "Verifying checksum ..."
curl -fsSL -o "$TMP/SHA256SUMS" "${BASE_URL}/SHA256SUMS"
cd "$TMP"

if command -v sha256sum >/dev/null 2>&1; then
  grep "$TARBALL" SHA256SUMS | sha256sum -c -
elif command -v shasum >/dev/null 2>&1; then
  grep "$TARBALL" SHA256SUMS | shasum -a 256 -c -
else
  echo "WARNING: No sha256sum / shasum found — skipping checksum verification." >&2
fi

cd - >/dev/null

# ── Extract ────────────────────────────────────────────────────────────────
echo "Extracting ..."
tar -xzf "$TMP/$TARBALL" -C "$TMP"
EXTRACTED="$TMP/pipelyn-${PIPELYN_VERSION}-${TARGET}"

# ── Install ────────────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR" "$BIN_DIR"

# Remove previous installation
rm -rf "${INSTALL_DIR:?}/"*
cp -r "$EXTRACTED"/. "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/pipelyn"

# ── Launcher script ────────────────────────────────────────────────────────
# The binary resolves asset paths relative to its own location, so we need
# a wrapper that execs from the install directory rather than a bare symlink.
cat > "$BIN_DIR/pipelyn" << LAUNCHER
#!/bin/sh
exec "$INSTALL_DIR/pipelyn" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/pipelyn"

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo "  Pipelyn ${PIPELYN_VERSION} installed successfully!"
echo ""

# Check if BIN_DIR is already on PATH
case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "  Run:  pipelyn"
    ;;
  *)
    echo "  To use pipelyn, add the following to your shell profile:"
    echo ""
    echo "    export PATH=\"\$PATH:$BIN_DIR\""
    echo ""
    echo "  Or run it directly:"
    echo ""
    echo "    $BIN_DIR/pipelyn"
    ;;
esac
echo ""
