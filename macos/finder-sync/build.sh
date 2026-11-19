#!/usr/bin/env bash
# Build GitStudioFinder.appex (the Finder Sync extension) into macos/build/.
#   macos/finder-sync/build.sh [target-triple] [version]
# Called by scripts/build-overlay.mjs before `tauri build` on macOS; tauri.conf.json copies
# the result into GitStudio.app/Contents/PlugIns/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
triple="${1:-$(uname -m)-apple-darwin}"
version="${2:-0.0.0}"
case "$triple" in
  aarch64-*|arm64-*) arch=arm64 ;;
  x86_64-*) arch=x86_64 ;;
  universal-*) arch=universal ;;
  *) echo "unsupported target $triple" >&2; exit 1 ;;
esac

out="$root/macos/build/GitStudioFinder.appex"
rm -rf "$out"
mkdir -p "$out/Contents/MacOS" "$out/Contents/Resources"
sdk="$(xcrun --sdk macosx --show-sdk-path)"

compile() {
  xcrun swiftc -O -module-name GitStudioFinder -sdk "$sdk" \
    -target "$1-apple-macos11.0" -application-extension \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -framework Cocoa -framework FinderSync \
    "$here/FinderSync.swift" -o "$2"
}

if [ "$arch" = universal ]; then
  compile arm64 "$out/Contents/MacOS/GitStudioFinder-arm64"
  compile x86_64 "$out/Contents/MacOS/GitStudioFinder-x86_64"
  lipo -create -output "$out/Contents/MacOS/GitStudioFinder" \
    "$out/Contents/MacOS/GitStudioFinder-arm64" "$out/Contents/MacOS/GitStudioFinder-x86_64"
  rm "$out/Contents/MacOS/GitStudioFinder-"*
else
  compile "$arch" "$out/Contents/MacOS/GitStudioFinder"
fi

sed "s/__VERSION__/$version/g" "$here/Info.plist" > "$out/Contents/Info.plist"
cp "$root/src-tauri/overlay/overlay-"*.png "$out/Contents/Resources/"

# Signed with the release identity when one is configured, ad hoc otherwise (enough for a local
# build; Finder only loads signed extensions).
identity="${APPLE_SIGNING_IDENTITY:--}"
codesign --force --options runtime --timestamp=none \
  --entitlements "$here/FinderSync.entitlements" --sign "$identity" "$out"
echo "built $out"
