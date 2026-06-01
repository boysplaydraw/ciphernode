# CipherNode Crypto Package

Client-side E2EE helpers should move here incrementally from `client/lib/crypto.ts`.

The relay migration does not move private keys or plaintext handling to the server. The Go backend only relays encrypted payloads and stores encrypted blobs plus metadata.
