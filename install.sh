#!/usr/bin/env sh
# Build `fr` and install the standalone binary onto PATH so every terminal / Claude Code
# session can run it. The binary embeds the Bun runtime — no runtime deps.
#
#   sh install.sh                      # auto: /usr/local/bin if writable, else ~/.local/bin
#   FR_INSTALL_DIR=/path sh install.sh # explicit destination
#   sudo sh install.sh                 # system-wide (all users) into /usr/local/bin
set -e
cd "$(dirname "$0")"

echo "[fr] building standalone binary…"
bun install >/dev/null 2>&1 || true
bun run build

DEST="${FR_INSTALL_DIR:-}"
if [ -z "$DEST" ]; then
  if [ -w /usr/local/bin ]; then DEST=/usr/local/bin; else DEST="$HOME/.local/bin"; fi
fi
mkdir -p "$DEST"
cp dist/fr "$DEST/fr"
chmod +x "$DEST/fr"
echo "[fr] installed → $DEST/fr"

case ":$PATH:" in
  *":$DEST:"*) echo "[fr] $DEST is on PATH ✓" ;;
  *) echo "[fr] WARNING: $DEST is not on PATH. Add it, e.g.:  export PATH=\"$DEST:\$PATH\"" ;;
esac

if "$DEST/fr" help >/dev/null 2>&1; then
  echo "[fr] smoke OK — try:  fr help"
else
  echo "[fr] smoke FAILED — the binary did not run." >&2
  exit 1
fi
