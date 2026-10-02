# Changelog

## 1.1.2 - 2026-10-02

- Consolidate sidebar settings into one Settings button that opens settings-only navigation, with Back to dashboards restoring the current dashboard or history view. Support both expanded and collapsed sidebars.
- Add manual update checks against the latest GitHub release, showing the installed version, available updates, and release download links, with clear results for missing releases and connection failures.

## 1.1.1 - 2026-10-01

- Reduce desktop release size by excluding frontend-only packages from production dependencies and pruning dependency tests, examples, type declarations, and source maps while preserving runtime files and license notices.
- Explain the bundled Node.js runtime and dependencies in the Windows download instructions.

## 1.1.0 - 2026-09-30

- Check direct device connections from Source settings, with separate ping, Modbus/TCP, and FTP results.
- Match existing devices by project and device ID when updating source settings, preserving saved FTP passwords when host or FTP username changes.
- Show the full application version in the sidebar footer.
- Clarify supported device models and desktop app signing in the documentation.

## 1.0.0 - 2026-09-29

- Build dashboards with movable and resizable measurement tiles, groups, graphs, and fullscreen rotation.
- Connect to GridVis REST or directly to Janitza devices over Modbus/TCP.
- Collect and export measurement history; view supported device and event history from direct connections.
- Configure display alarms, sound, and notifications.
- Export and import dashboard layouts.
- Package desktop releases for Windows x64, macOS Apple Silicon and Intel, and Linux x64.
