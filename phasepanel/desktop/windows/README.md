# Windows desktop build

From the application directory, run `desktop/windows/build.ps1` in PowerShell on an x64 Windows machine with Node.js 24 or newer, npm, .NET 10 SDK, and internet access. The script builds the application, downloads and verifies the official Node.js runtime, publishes the native launcher, and creates a versioned zip archive in `dist/windows/`.

Extract the archive and run `PhasePanel.exe`. It starts the bundled server on `127.0.0.1` and opens the dashboard in the default browser. The notification area icon opens the dashboard again or quits the server. Data and logs are stored in `%LOCALAPPDATA%\PhasePanel\`.

To change the database folder, open **Data location** under **Settings**, choose a folder, and save. Quit PhasePanel, move `dashboards.db` there if you want to keep existing data, and restart. The log stays in the default folder.

To keep the same dashboard URL, open **Server address** under **Settings**, choose **Fixed port**, enter a port from 1024 to 65535, and restart PhasePanel. The default is an automatically chosen free port.

The executable is unsigned. Windows may show a SmartScreen warning until a future release is signed with a trusted code signing certificate.
