#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="$repo_dir/dist/macos"
app_dir="$output_dir/PhasePanel.app"
resources_dir="$app_dir/Contents/Resources"
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT
node_version="${NODE_VERSION:-24.21.0}"
architecture="$(uname -m)"
case "$architecture" in
  arm64) node_architecture=arm64 ;;
  x86_64) node_architecture=x64 ;;
  *) echo "Unsupported macOS architecture: $architecture" >&2; exit 1 ;;
esac
runtime_name="node-v${node_version}-darwin-${node_architecture}"
release_url="https://nodejs.org/dist/v${node_version}"

cd "$repo_dir"
npm run build
rm -rf "$app_dir"
mkdir -p "$resources_dir/app/dist" "$app_dir/Contents/MacOS"
cp -R dist/client dist/server dist/shared "$resources_dir/app/dist/"
cp package.json "$resources_dir/app/"
cp LICENSE "$resources_dir/"
cp package.json package-lock.json "$staging_dir/"
(cd "$staging_dir" && npm ci --omit=dev --prefer-offline --no-audit)
cp -R "$staging_dir/node_modules" "$resources_dir/app/"
curl -fsSL "$release_url/SHASUMS256.txt" -o "$staging_dir/SHASUMS256.txt"
curl -fsSL "$release_url/$runtime_name.tar.gz" -o "$staging_dir/$runtime_name.tar.gz"
(cd "$staging_dir" && awk -v file="$runtime_name.tar.gz" '$2 == file { print }' SHASUMS256.txt | shasum -a 256 -c -)
tar -xzf "$staging_dir/$runtime_name.tar.gz" -C "$staging_dir"
cp "$staging_dir/$runtime_name/bin/node" "$resources_dir/node"
cp "$staging_dir/$runtime_name/LICENSE" "$resources_dir/NODE-LICENSE"
chmod +x "$resources_dir/node"
clang -fobjc-arc -mmacosx-version-min=14.0 -framework Cocoa "$repo_dir/desktop/macos/Launcher.m" -o "$app_dir/Contents/MacOS/PhasePanel"
clang -fobjc-arc -mmacosx-version-min=14.0 -framework Foundation -framework CoreGraphics -framework ImageIO "$repo_dir/desktop/macos/IconRenderer.m" -o "$staging_dir/icon-renderer"
iconset_dir="$staging_dir/AppIcon.iconset"
mkdir -p "$iconset_dir"
for size in 16 32 128 256 512; do
  "$staging_dir/icon-renderer" "$iconset_dir/icon_${size}x${size}.png" "$size" app
  "$staging_dir/icon-renderer" "$iconset_dir/icon_${size}x${size}@2x.png" "$((size * 2))" app
done
"$staging_dir/icon-renderer" "$resources_dir/MenuBarIcon.png" 80 menu
iconutil -c icns "$iconset_dir" -o "$resources_dir/AppIcon.icns"

app_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
cat > "$app_dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>PhasePanel</string>
  <key>CFBundleDisplayName</key><string>PhasePanel</string>
  <key>CFBundleIdentifier</key><string>local.phasepanel.desktop</string>
  <key>CFBundleVersion</key><string>$app_version</string>
  <key>CFBundleShortVersionString</key><string>$app_version</string>
  <key>CFBundleExecutable</key><string>PhasePanel</string>
  <key>CFBundleIconFile</key><string>AppIcon.icns</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST

codesign --force --deep --sign - "$app_dir"
rm -f "$output_dir/PhasePanel-macOS-${architecture}.zip"
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$output_dir/PhasePanel-v${app_version}-macos-${architecture}.zip"
echo "Built $app_dir"
