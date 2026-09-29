# Linux desktop build

From the application directory, run `bash desktop/linux/build.sh` on an x64 or ARM64 Linux machine with Node.js 24 or newer, npm, curl, tar, and internet access. The output is a versioned archive in `dist/linux/`. The build downloads the official Node.js runtime and verifies its SHA-256 checksum.

Extract the archive and run `PhasePanel/phasepanel`. It starts the bundled server on `127.0.0.1` and opens the dashboard with `xdg-open`. To stop it, run `PhasePanel/phasepanel --stop`. Optionally run `PhasePanel/install-desktop.sh` to add a launcher to the desktop application menu. Run that installer again if you move the extracted directory.

Data and logs are stored in `${XDG_DATA_HOME:-~/.local/share}/phasepanel/`. The Linux archive is built for its runner architecture; the release workflow currently produces x64.

To change the database folder, open **Data location** under **Settings**, choose a folder, and save. Stop PhasePanel, move `dashboards.db` there if you want to keep existing data, and restart. The log and session file stay in the default folder.

To keep the same dashboard URL, open **Server address** under **Settings**, choose **Fixed port**, enter a port from 1024 to 65535, and restart PhasePanel. The default is an automatically chosen free port.
