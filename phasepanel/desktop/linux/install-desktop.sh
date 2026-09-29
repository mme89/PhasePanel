#!/bin/sh
set -eu
bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
applications_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$applications_dir"
cat > "$applications_dir/phasepanel.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=PhasePanel
Comment=Live power monitoring dashboard
Exec="$bundle_dir/phasepanel"
Icon=$bundle_dir/AppIcon.png
Terminal=false
Categories=Utility;
EOF
echo "Installed $applications_dir/phasepanel.desktop"
