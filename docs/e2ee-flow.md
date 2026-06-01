# E2EE Flow

CipherNode encryption remains client-side.

1. Clients generate and store private keys locally.
2. Public keys can be published to the relay for contact discovery.
3. Message plaintext is encrypted on the sending client.
4. The relay receives only encrypted payloads, routing metadata, file metadata and timestamps.
5. The receiving client decrypts locally.

The Go backend must not receive private keys, shared secrets or plaintext message bodies. File uploads are expected to contain encrypted data only.

Metadata remains visible to the relay: sender and recipient IDs, connection timing, IP-level network metadata, file sizes, MIME types if supplied, message counts and group membership data needed for relay behavior.
