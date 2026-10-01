#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="$repo_dir/dist/linux"
bundle_dir="$output_dir/PhasePanel"
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT
node_version="${NODE_VERSION:-24.21.0}"
case "$(uname -m)" in
  x86_64) architecture=x64 ;;
  aarch64) architecture=arm64 ;;
  *) echo "Unsupported Linux architecture" >&2; exit 1 ;;
esac
runtime_name="node-v${node_version}-linux-${architecture}"
release_url="https://nodejs.org/dist/v${node_version}"

cd "$repo_dir"
npm run build
rm -rf "$bundle_dir"
mkdir -p "$bundle_dir/app/dist"
cp -R dist/client dist/server dist/shared "$bundle_dir/app/dist/"
cp package.json "$bundle_dir/app/"
cp LICENSE "$bundle_dir/"
cp package.json package-lock.json "$staging_dir/"
(cd "$staging_dir" && npm ci --omit=dev --prefer-offline --no-audit)
node desktop/prune-dependencies.mjs "$staging_dir/node_modules"
cp -R "$staging_dir/node_modules" "$bundle_dir/app/"
curl -fsSL "$release_url/SHASUMS256.txt" -o "$staging_dir/SHASUMS256.txt"
curl -fsSL "$release_url/$runtime_name.tar.xz" -o "$staging_dir/$runtime_name.tar.xz"
(cd "$staging_dir" && awk -v file="$runtime_name.tar.xz" '$2 == file { print }' SHASUMS256.txt | sha256sum -c -)
tar -xJf "$staging_dir/$runtime_name.tar.xz" -C "$staging_dir"
cp "$staging_dir/$runtime_name/bin/node" "$bundle_dir/node"
cp "$staging_dir/$runtime_name/LICENSE" "$bundle_dir/NODE-LICENSE"
cp desktop/linux/launcher.mjs desktop/linux/phasepanel desktop/linux/install-desktop.sh desktop/linux/AppIcon.png "$bundle_dir/"
chmod +x "$bundle_dir/node" "$bundle_dir/phasepanel" "$bundle_dir/install-desktop.sh"
app_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
tar -czf "$output_dir/PhasePanel-v${app_version}-linux-${architecture}.tar.gz" -C "$output_dir" PhasePanel
echo "Built $output_dir/PhasePanel-v${app_version}-linux-${architecture}.tar.gz"
