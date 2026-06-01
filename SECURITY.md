# Security

CipherNode aims to keep E2EE content client-side. The Go backend added in this migration is a relay and temporary storage service; it must not decrypt message content or encrypted file blobs.

## Reporting

Do not publish exploitable issues publicly before maintainers have a chance to respond. Include reproduction steps, affected version or commit, impact and suggested mitigation when possible.

## Current Status

- External security audit: not completed.
- Go relay: migration scaffold with tests for storage and replay protection.
- Tauri desktop: command scaffold, not full Electron parity yet.

Avoid treating this repository as production-hardened until the migration is complete and reviewed.
