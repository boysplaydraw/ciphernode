# Production Readiness

## Health Checks

- `GET /health`: process health, active connection count, relay metrics.
- `GET /api/health`: same payload for API clients and proxy checks.
- `GET /api/stats`: storage stats plus connection and transport counters.

## Structured Logging

The Go relay emits JSON log lines for WebSocket connect, disconnect, and upgrade failures. Client transport logs use the `[Transport]` prefix and include state, relay health, P2P preference, reason, and timestamp.

## Metrics

Relay metrics currently include:

- `connectionsTotal`
- `disconnectsTotal`
- `messagesTotal`
- `groupMessagesTotal`
- `signalsTotal`
- `filesTotal`

Transport metrics are currently client-side logs for `relay`, `p2p_connecting`, `p2p_ready`, and `p2p_failed`.

## Transport Selection

Relay is always the default. P2P is only used after all readiness gates pass:

- PeerConnection connected.
- DataChannel open.
- CipherNode `transport_hello` handshake completed.

Fallback happens automatically on DataChannel close/error, PeerConnection failure/disconnect/close, timeout, or handshake mismatch.

## Media Routing

Files at or below the relay limit use relay. Larger files are eligible for P2P only when WebRTC is available and the transport state is `p2p_ready`. Otherwise the app reports the file as too large instead of silently dropping it into a broken P2P route.

## Android Startup Diagnostics

Startup diagnostics are stored in AsyncStorage under `@ciphernode/startup_diagnostics`. They include startup stage, platform, app version, execution environment, configured API URL, and captured fatal/global errors.

## Troubleshooting

- Health fails: check container process, exposed port `5000`, and reverse proxy routing.
- WebSocket fails: confirm the proxy supports Upgrade headers and the client uses `wss://` for HTTPS deployments.
- APK crashes immediately: inspect diagnostics and confirm native-only optional dependencies are not statically imported.
- P2P shows connected on one peer only: verify both peers log `p2p_ready`; otherwise the UI should remain Relay/Offline.
- Refresh leaves stale P2P state: state resets to relay unless the handshake is completed again.
