#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
repo_root=$PWD

[ "$#" -eq 0 ] || {
  echo "Usage: $0" >&2
  exit 2
}

arch=arm64
binary="$repo_root/release/epub.ts-darwin-${arch}"

version=$(node -p "require('./package.json').version")
short_version=$(printf '%s\n' "$version" | sed -E -n 's/^([0-9]+(\.[0-9]+){0,2}).*/\1/p')

bundle_parent="$repo_root/release/macos-${arch}"
bundle="$bundle_parent/epub.ts.app"
contents="$bundle/Contents"
resources="$contents/Resources"
rm -rf "$bundle_parent"
mkdir -p "$contents/MacOS" "$resources" "$contents/Library/LaunchAgents"
cp "$binary" "$contents/MacOS/epub-ts-launcher"
chmod 0755 "$contents/MacOS/epub-ts-launcher"
xcrun swiftc -O -target arm64-apple-macosx13.0 \
  packaging/macos/main.swift -o "$contents/MacOS/epub.ts"
cp packaging/macos/io.github.jay-waves.epub-ts.agent.plist "$contents/Library/LaunchAgents/"
sed \
  -e "s/@@SHORT_VERSION@@/$version/g" \
  -e "s/@@BUNDLE_VERSION@@/$short_version/g" \
  packaging/macos/Info.plist > "$contents/Info.plist"

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/epub-ts-dmg.XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM
iconset="$temporary_directory/epub-ts.iconset"
mkdir "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" assets/icon.png \
    --out "$iconset/icon_${size}x${size}.png" >/dev/null
done
for pair in '16 32' '32 64' '128 256' '256 512' '512 1024'; do
  set -- $pair
  sips -z "$2" "$2" assets/icon.png \
    --out "$iconset/icon_${1}x${1}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$resources/epub-ts.icns"

# ServiceManagement needs a signed bundle. Ad-hoc signing supports local builds
# without a Developer ID certificate; releases remain unnotarized.
codesign --force --sign - --identifier io.github.jay-waves.epub-ts.launcher "$contents/MacOS/epub-ts-launcher"
codesign --force --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
plutil -lint "$contents/Info.plist" "$contents/Library/LaunchAgents/io.github.jay-waves.epub-ts.agent.plist"
"$contents/MacOS/epub.ts" autostart status

image_root="$temporary_directory/image"
mkdir "$image_root"
ditto "$bundle" "$image_root/epub.ts.app"
ln -s /Applications "$image_root/Applications"

output="$repo_root/release/epub-ts-${version}-aarch64-apple-darwin.dmg"
rm -f "$output"
"${EPUB_TS_HDIUTIL:-hdiutil}" create \
  -volname epub.ts \
  -srcfolder "$image_root" \
  -format UDZO \
  -ov \
  "$output"
