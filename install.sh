#!/usr/bin/env bash
set -euo pipefail

UUID=zellij-sessions-manager@darkwing4.dev
REPO=https://github.com/Darkwing4/zellij-session-manager
DEST=$HOME/.local/share/gnome-shell/extensions/$UUID
FILES=(extension.js metadata.json stylesheet.css logo.png LICENSE schemas)

for cmd in git glib-compile-schemas gsettings; do
    command -v "$cmd" >/dev/null || { echo "install.sh: '$cmd' is required" >&2; exit 1; }
done

if [[ -L "$DEST" ]]; then
    echo "install.sh: $DEST is a symlink (development checkout?), refusing to overwrite it" >&2
    exit 1
fi

SRC=$(cd "$(dirname "${BASH_SOURCE[0]:-/dev/null}")" 2>/dev/null && pwd || true)
if [[ -z "$SRC" || ! -f "$SRC/metadata.json" ]] || ! grep -q "\"$UUID\"" "$SRC/metadata.json"; then
    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    git clone --quiet --depth 1 "$REPO" "$TMP/src"
    SRC=$TMP/src
fi

mkdir -p "$DEST"
for f in "${FILES[@]}"; do
    rm -rf "${DEST:?}/$f"
    cp -r "$SRC/$f" "$DEST/"
done
glib-compile-schemas "$DEST/schemas"

if ! gnome-extensions enable "$UUID" 2>/dev/null; then
    current=$(gsettings get org.gnome.shell enabled-extensions)
    if [[ "$current" != *"'$UUID'"* ]]; then
        if [[ "$current" == "@as []" ]]; then
            gsettings set org.gnome.shell enabled-extensions "['$UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${current%]}, '$UUID']"
        fi
    fi
fi

echo "Installed to $DEST"
echo "Log out and back in to load the extension (GNOME Shell cannot be restarted on Wayland)."
