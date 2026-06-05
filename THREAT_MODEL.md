# Threat Model

CipherNode is designed for accountless encrypted messaging with self-hostable infrastructure.

## Assets

- Message plaintext.
- Private identity keys.
- Contact public keys and local address book.
- File encryption keys and encrypted file payloads.
- Delivery metadata such as sender, recipient, timing, online state, IP address, and payload size.

## Trusted Components

- The local client device and app runtime.
- The cryptographic libraries used by the client.
- The user-controlled deployment environment when self-hosted.

## Untrusted Components

- The relay operator for hosted deployments.
- Network intermediaries.
- WebRTC network paths and STUN infrastructure.
- Other users and contacts.

## Protections

- Message contents are encrypted client-side before relay transport.
- The relay handles encrypted payloads and public routing metadata only.
- HTTPS/WSS protects transport against passive network observers.
- Replay protection and rate limits reduce relay abuse.
- P2P is an optional upgrade and does not disable relay fallback until it is verified ready.

## Non-Goals

- Protecting plaintext on a compromised or unlocked device.
- Preventing recipients from copying, exporting, or screenshotting messages.
- Hiding all metadata from the relay.
- Preventing traffic-correlation attacks by a powerful network adversary.
- Guaranteeing delivery when every relay and direct path is unavailable.

## Transport Assumptions

Relay mode is the default. P2P mode is usable only after:

- PeerConnection state is `connected`.
- DataChannel state is `open`.
- CipherNode transport handshake has completed.

Fallback to relay is required on:

- DataChannel close or error.
- PeerConnection `failed`, `disconnected`, or `closed`.
- Connection timeout.
- Handshake peer mismatch.

## WebRTC and Tor

WebRTC can expose IP metadata through ICE/STUN. CipherNode treats WebRTC as unavailable while Tor mode is enabled. Users who need stronger network anonymity should use relay over Tor/.onion instead of P2P.

## Remaining Risks

- Relay metadata visibility.
- Client-side storage extraction on compromised devices.
- Malicious contacts sending malformed encrypted payloads or files.
- Supply-chain risk in npm, Expo, Go, and desktop packaging dependencies.
- Native mobile WebRTC remains disabled until the dependency and permissions are explicitly added and tested.
