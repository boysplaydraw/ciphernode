# Electron to Tauri Migration

## Current Electron Surface

The Electron app uses:

- `electron/main.ts` for BrowserWindow creation, static web serving, proxy control, app reset, update checks, biometric prompts, WebTorrent and OnionShare IPC.
- `electron/preload.ts` for a `window.electronAPI` bridge.
- `electron/tor-manager.ts` for bundled/system Tor process management and SOCKS proxy status.
- `electron/onion-share.ts` for temporary local file sharing.

## Tauri Target

`apps/desktop` contains the new Tauri shell. It points at the existing Expo Web frontend in dev and at the exported `dist` folder for production.

Native operations move from Electron IPC to Tauri commands:

- `start_tor`
- `stop_tor`
- `get_tor_status`
- `configure_proxy`

The current implementation is a command-safe scaffold. Actual bundled Tor process spawning should be added behind these commands after binary packaging paths are finalized.

## Compatibility Plan

1. Keep Electron scripts while Tauri reaches feature parity.
2. Use the existing web frontend without moving screens yet.
3. Replace `window.electronAPI` calls with a platform bridge that can call either Electron IPC or Tauri `invoke`.
4. Move Tor, OnionShare, WebTorrent and updater functionality one command group at a time.
5. Remove Electron dependencies only after desktop release builds and native command tests pass on Windows, macOS and Linux.

## Security Notes

The Tauri configuration uses a restrictive CSP, no shell plugin, and only core permissions. External navigation should remain allowlisted to localhost development URLs and the configured relay/domain.
