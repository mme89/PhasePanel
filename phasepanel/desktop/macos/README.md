# macOS test build

From the application directory, run `bash desktop/macos/build.sh` on a Mac with Node.js 24 or newer, npm, Xcode Command Line Tools, and internet access. The script builds the frontend and server, installs production dependencies from `package-lock.json`, downloads and verifies the official Node.js runtime, and creates `dist/macos/PhasePanel.app` plus a versioned zip archive beside it.

Open the app to start a local server and launch the dashboard in the default browser. The menu bar item opens the dashboard again or quits the server. Data and the server log are stored in `~/Library/Application Support/PhasePanel/`.

To change the database folder, open **Data location** under **Settings**, choose a folder, and save. Quit PhasePanel, move `dashboards.db` there if you want to keep existing data, and restart. The log stays in the default folder.

To keep the same dashboard URL, open **Server address** under **Settings**, choose **Fixed port**, enter a port from 1024 to 65535, and restart PhasePanel. The default is an automatically chosen free port.

The app is ad hoc signed for local testing. A release for other Macs would need Apple Developer ID signing and notarization. Build separately on Apple Silicon and Intel Macs for both architectures.
