# Changelog

## 1.2.0 - 2026-11-24

- Add built-in Modbus/TCP register maps and documented electrical value catalogs for seven additional native Ethernet Janitza devices (`UMG 605-PRO`, `UMG 509-PRO`, `UMG 512-PRO`, `UMG 96-PA`, `UMG 96-PQ-L`, `UMG 96RM-E`, and `UMG 508`), with automatic migration for existing databases and updated documentation.
- Redesign the **Device models and mappings** dialog with collapsed-by-default model cards, a wider layout, searchable bounded mapping tables, a collapsible documented catalog, and one-click **Add** buttons that automatically maintain covering register blocks.
- Upgrade the dashboard editor with Undo/Redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`), one-click tile duplication (`Ctrl/Cmd+D`), quick 3-phase (`L1–L3`) selection in bulk add, live reading previews for unsaved tiles (`POST /api/readings/preview`), `Shift+Click` multi-select with a floating alignment/grouping toolbar, editor keyboard shortcuts, and gauge/alarm support in Total tiles plus bar/status/sparkline options in bulk add.
- Improve editor ergonomics and reliability: sticky edit header with dirty-state tracking, inline Save validation errors, revision conflict recovery (**Save as copy** and **Download draft JSON**), `Ctrl/Cmd+Wheel` canvas zoom without losing scroll/zoom on resolution edits, keyboard nudging for groups, consistent drag handles, and fixes for stale `tileLinks` save lockouts, narrow right-edge tiles, keyboard-nudge drag freezes, `CopyGroupEditor` multi-meter consumption validation, `GraphTileEditor` group leaks, overflowing group resize collapse, and 100-tile limit guards.
- Upgrade alarm audio with higher full-scale volume through a dynamics limiter, proper attack/sustain/release envelopes, and four new alarm sounds (**Triple beep**, **Klaxon**, **Bell**, and **Radar**).
- Harden security across desktop settings, credentials, notifications, and exports: enforce loopback socket checks alongside `Host` validation on desktop storage/server routes, require re-entering stored FTP/GridVis/SMTP passwords when changing target hosts or URLs, validate Telegram bot tokens and hostnames, and use RFC 4180 CSV escaping with spreadsheet formula neutralization.
- Improve backend and data acquisition reliability: prevent notification head-of-line blocking and cancelled-delivery resurrection, cancel pending alerts immediately when deleting a dashboard, preserve batch dashboard order, fix Modbus register block collisions and serialize per-device reads, cap GridVis/Modbus response sizes and support single/empty Jersey wrappers, and harden FTP event/recording parsing, abort handling, and sync progress tracking.
- Fix frontend and layout edge cases across canvas zoom/bounds/keyboard nudging, edit-mode Cancel/Save validation, async race conditions, alarm sound cleanup, DST fall-back consumption buckets, chart zero-width guards, and settings dialogs.
- Optimize SQLite and UI performance with a pending-notifications index, read-without-write-lock notification settings, transactional updates, bounded history downsampling, cached source settings, and reduced frontend re-rendering/formatting overhead.
- Improve accessibility (`LineGraph` ARIA roles, unique FTP field labels, and closable settings dialogs on load error) and harden Docker/Compose defaults (`init: true`, `no-new-privileges`, dynamic `PORT` healthcheck, and read-only runtime code).

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
