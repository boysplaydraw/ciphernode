# CipherNode Threat Model

## Assets

- Client private keys and local identity material
- Message plaintext
- Encrypted message payloads
- Public keys
- Relay metadata such as user IDs, timestamps, IPs, file sizes and group membership

## Trust Boundaries

- Clients are trusted with plaintext and private keys.
- The relay is not trusted with plaintext.
- Transport security depends on HTTPS/WSS or a trusted local/Tor route.
- Desktop native commands are privileged compared with web UI code.

## Relay Responsibilities

The Go backend is a relay/storage component. It may:

- Track connected users.
- Store public keys.
- Queue encrypted pending messages.
- Store encrypted temporary file blobs and file metadata.
- Enforce TTL cleanup, rate limits and replay checks.

It must not decrypt E2EE message or file content.

## Known Metadata Risks

The relay can observe connection timing, sender/recipient identifiers, group membership, file size, MIME type, message frequency and IP-derived network metadata unless hidden by Tor or another network layer.

## Abuse Protection

Current Go migration includes rate limiting, nonce/timestamp replay checks and TTL cleanup. This is not a complete abuse-prevention system and has not been externally audited.
