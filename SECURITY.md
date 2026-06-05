# Security Policy

CipherNode is an accountless E2EE messenger. Please report vulnerabilities privately before publishing details.

## Reporting

Email: support@cipher-node.site

Include:

- Affected version, commit, platform, and deployment mode.
- Clear reproduction steps.
- Logs with secrets, private keys, and message contents removed.
- Impact assessment and suggested fix if available.

## Scope

In scope:

- Message encryption or key handling flaws.
- Relay authentication, replay, rate-limit, or WebSocket routing bugs.
- File-transfer disclosure or integrity issues.
- Transport fallback failures that can drop or misroute messages.
- Docker, Caddy, and deployment defaults that weaken production security.

Out of scope:

- Social engineering.
- Physical access to unlocked devices.
- Issues requiring a compromised client device.
- Denial of service without a security boundary impact.

## Supported Versions

Security fixes target the `main` branch and latest release artifacts.

## Operational Guidance

- Use HTTPS/WSS in production.
- Keep relay logs free of plaintext and private keys.
- Prefer self-hosting for sensitive deployments.
- Disable WebRTC when using Tor or when IP metadata exposure is unacceptable.
