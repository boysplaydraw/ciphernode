# CipherNode Shared Package

`packages/shared` holds migration-safe protocol and transport helpers.

- `transport/socketio.ts` keeps the current Node.js Socket.IO relay compatible.
- `transport/websocket.ts` targets the Go relay at `/ws`.
- `EXPO_PUBLIC_RELAY_TRANSPORT=websocket` selects the Go WebSocket adapter.
- The default remains `socketio` so existing mobile and web builds keep working.
