# Contributing

Thanks for improving CipherNode. Keep changes focused, testable, and aligned with the project goals: accountless E2EE messaging, a small Go relay, React Native/Web/Desktop clients, Docker self-hosting, and optional P2P with relay fallback.

## Development

```bash
npm install
npm run go:server:test
npm run check:types
```

Useful commands:

- `npm run go:server:dev` starts the Go relay.
- `npx expo start` starts the client.
- `npm run electron:build:web` builds the web export used by desktop/Tauri.

## Pull Requests

- Describe the user-visible behavior change.
- Include tests or a clear reason tests are not practical.
- Do not weaken relay fallback, E2EE boundaries, or Tor/WebRTC safeguards.
- Keep secrets, private keys, and production URLs out of commits unless they are documented public defaults.

## Transport Rules

- Relay is the default transport.
- P2P is only ready after PeerConnection connected, DataChannel open, and handshake complete.
- DataChannel close, PeerConnection failure, or timeout must fall back to relay.
- UI must not show P2P unless transport state is `p2p_ready`.

## Security Changes

For security-sensitive changes, update [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md) when assumptions change.
